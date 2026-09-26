// Whether someone may use the app check-in button, and from where. Rules come
// from the company defaults, overridden per employee:
//   method: APP (button only), MACHINE (attendance machine only), BOTH
//   office network: the request must come from one of the office networks
//   office location: the phone's GPS must be within an office's radius

import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { effectiveRules, ipAllowed, nearestOffice } from './punch-rules';

export interface CheckInContext {
  ip: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

@Injectable()
export class CheckInRulesService {
  constructor(private prisma: PrismaService) {}

  async rulesFor(organizationId: string, employee: { checkInMethod: string | null; requireOfficeNetwork: boolean | null; requireOfficeLocation: boolean | null }) {
    const s = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    return effectiveRules(employee, {
      defaultCheckInMethod: s?.defaultCheckInMethod ?? 'BOTH',
      defaultRequireOfficeNetwork: s?.defaultRequireOfficeNetwork ?? false,
      defaultRequireOfficeLocation: s?.defaultRequireOfficeLocation ?? false,
    });
  }

  // Throws a clear message if the app button isn't allowed here; returns
  // what to store on the attendance record (address, location, which office).
  async check(
    organizationId: string,
    actorUserId: string,
    employee: { id: string; checkInMethod: string | null; requireOfficeNetwork: boolean | null; requireOfficeLocation: boolean | null },
    ctx: CheckInContext,
    action: 'check-in' | 'check-out',
  ) {
    const rules = await this.rulesFor(organizationId, employee);
    const info: Record<string, string | number | null> = { ip: ctx.ip };
    const refuse = async (reason: string, message: string): Promise<never> => {
      await this.prisma.auditEvent.create({
        data: {
          organizationId, actorUserId, eventType: 'attendance.checkin_blocked', entityType: 'Employee', entityId: employee.id,
          metadata: { action, reason, ip: ctx.ip, latitude: ctx.latitude ?? null, longitude: ctx.longitude ?? null },
        },
      });
      throw new ForbiddenException(message);
    };

    if (!rules.canUseApp) {
      await refuse('machine_only', 'Your attendance is recorded by the attendance machine — please use the machine.');
    }
    if (rules.needsOfficeNetwork) {
      const networks = await this.prisma.officeNetwork.findMany({ where: { organizationId }, select: { cidr: true } });
      if (!ipAllowed(ctx.ip, networks.map((n) => n.cidr))) {
        await refuse('outside_network', `You can only ${action.replace('-', ' ')} from the office network (Wi-Fi or cable). Your connection isn't one of them.`);
      }
      info.network = 'office';
    }
    if (ctx.latitude !== undefined && ctx.longitude !== undefined) {
      info.latitude = Math.round(ctx.latitude * 1e6) / 1e6;
      info.longitude = Math.round(ctx.longitude * 1e6) / 1e6;
      info.accuracy = ctx.accuracy !== undefined ? Math.round(ctx.accuracy) : null;
    }
    if (rules.needsOfficeLocation) {
      if (ctx.latitude === undefined || ctx.longitude === undefined) {
        await refuse('no_location', `Allow location access to ${action.replace('-', ' ')} — it has to be done at the office.`);
      }
      const offices = await this.prisma.officeLocation.findMany({ where: { organizationId } });
      const near = nearestOffice({ latitude: ctx.latitude!, longitude: ctx.longitude!, accuracy: ctx.accuracy }, offices);
      if (!near || !near.inside) {
        const away = near ? ` You're about ${near.distance >= 1000 ? `${(near.distance / 1000).toFixed(1)} km` : `${Math.round(near.distance)} m`} from ${near.office.name}.` : '';
        await refuse('outside_location', `You can only ${action.replace('-', ' ')} at the office.${away}`);
      }
      info.place = near!.office.name;
    }
    return info;
  }
}
