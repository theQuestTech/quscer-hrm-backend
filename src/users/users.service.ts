// WBS 1.8 (role assignment) and a minimal slice of 2.8 (give an employee a
// login). This is not the invitation/activation flow — HR sets a starting
// password and shares it — because auth is replaced by Quscer OS later
// (WBS 6.1) and shouldn't grow email flows before then.
//
// One email is one login across all companies. "Users" of a company are the
// logins with a Membership in it; switching someone off here only removes
// their access to this company. Someone who also works for other companies
// keeps their own password — no single company may reset it.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AddPersonDto, GrantLoginAccessDto } from './users.dto';
import { NotifyService } from '../notifications/notify.service';

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private notify: NotifyService,
  ) {}

  listRoles(organizationId: string) {
    return this.prisma.role.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async listUsers(organizationId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          include: {
            roleAssignments: { where: { organizationId }, include: { role: true } },
            memberships: { where: { isActive: true, organizationId: { not: organizationId } }, select: { id: true } },
          },
        },
      },
    });
    const userIds = memberships.map((m) => m.userId);
    const employees = await this.prisma.employee.findMany({
      where: { organizationId, userId: { in: userIds } },
      select: { id: true, userId: true, firstName: true, lastName: true, employeeNumber: true },
    });
    return memberships.map(({ user, isActive }) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
      isActive: isActive && user.isActive,
      // Also has access to other companies (e.g. outsourced HR).
      hasOtherCompanies: user.memberships.length > 0,
      roles: user.roleAssignments.map((a) => ({ id: a.role.id, name: a.role.name })),
      employee: employees.find((e) => e.userId === user.id) ?? null,
    }));
  }

  // Give someone access to this company without an employee record — an
  // outsourced HR person, accountant or consultant. If their email already
  // has a login (in any company) they use their existing password;
  // otherwise a new login is created with the password given here.
  async addPerson(organizationId: string, actorUserId: string, dto: AddPersonDto) {
    await this.assertRolesInOrg(organizationId, dto.roleIds);
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { email }, orderBy: { createdAt: 'asc' } });

    let userId: string;
    if (existing) {
      const membership = await this.prisma.membership.findUnique({
        where: { userId_organizationId: { userId: existing.id, organizationId } },
      });
      if (membership?.isActive) throw new ConflictException(`${email} already has access to this company`);
      userId = existing.id;
    } else {
      if (!dto.password) throw new BadRequestException('Set a starting password for this new login');
      const user = await this.prisma.user.create({
        data: {
          organizationId,
          email,
          passwordHash: await bcrypt.hash(dto.password, SALT_ROUNDS),
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });
      userId = user.id;
    }

    await this.prisma.$transaction([
      this.prisma.membership.upsert({
        where: { userId_organizationId: { userId, organizationId } },
        create: { userId, organizationId },
        update: { isActive: true },
      }),
      this.prisma.userRoleAssignment.deleteMany({ where: { userId, organizationId } }),
      this.prisma.userRoleAssignment.createMany({
        data: dto.roleIds.map((roleId) => ({ userId, roleId, organizationId, assignedById: actorUserId })),
      }),
    ]);
    await this.audit(organizationId, actorUserId, 'user.added', userId, {
      roleIds: dto.roleIds,
      existingLogin: !!existing,
    });
    this.notify.welcome(organizationId, userId, !existing);
    return { userId, existingLogin: !!existing };
  }

  async setRoles(organizationId: string, actorUserId: string, userId: string, roleIds: string[]) {
    await this.findUser(organizationId, userId);
    // Changing your own roles is the easiest way to lock everyone out of
    // Settings — have another admin do it.
    if (userId === actorUserId) {
      throw new BadRequestException('You cannot change your own roles');
    }
    await this.assertRolesInOrg(organizationId, roleIds);

    await this.prisma.$transaction([
      this.prisma.userRoleAssignment.deleteMany({ where: { userId, organizationId } }),
      this.prisma.userRoleAssignment.createMany({
        data: roleIds.map((roleId) => ({ userId, roleId, organizationId, assignedById: actorUserId })),
      }),
    ]);
    await this.audit(organizationId, actorUserId, 'user.roles_changed', userId, { roleIds });
    return (await this.listUsers(organizationId)).find((u) => u.id === userId);
  }

  async updateUser(organizationId: string, actorUserId: string, userId: string, isActive?: boolean) {
    await this.findUser(organizationId, userId);
    if (userId === actorUserId && isActive === false) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    // Only their access to this company — the login may be used elsewhere.
    if (isActive !== undefined) {
      await this.prisma.membership.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { isActive },
      });
    }
    await this.audit(organizationId, actorUserId, 'user.updated', userId, { isActive });
    return (await this.listUsers(organizationId)).find((u) => u.id === userId);
  }

  async grantLoginAccess(
    organizationId: string,
    actorUserId: string,
    employeeId: string,
    dto: GrantLoginAccessDto,
  ) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.userId) throw new ConflictException('This employee already has login access');
    if (!dto.password === !dto.userId) {
      throw new BadRequestException('Send either a password (new login) or a userId (link an existing login)');
    }

    let userId: string;
    let linkedExistingLogin = false;
    if (dto.userId) {
      await this.findUser(organizationId, dto.userId);
      const alreadyLinked = await this.prisma.employee.findFirst({
        where: { organizationId, userId: dto.userId },
      });
      if (alreadyLinked) throw new ConflictException('That login is already linked to another employee');
      userId = dto.userId;
    } else {
      const roleIds = dto.roleIds?.length ? dto.roleIds : [await this.employeeRoleId(organizationId)];
      await this.assertRolesInOrg(organizationId, roleIds);
      const email = employee.email.toLowerCase();
      const existing = await this.prisma.user.findFirst({ where: { email }, orderBy: { createdAt: 'asc' } });
      if (existing) {
        // Same person already has a login (e.g. from another company): link
        // it — they keep their own password.
        const alreadyLinked = await this.prisma.employee.findFirst({
          where: { organizationId, userId: existing.id },
        });
        if (alreadyLinked) throw new ConflictException('That login is already linked to another employee');
        userId = existing.id;
        linkedExistingLogin = true;
      } else {
        const user = await this.prisma.user.create({
          data: {
            organizationId,
            email,
            passwordHash: await bcrypt.hash(dto.password!, SALT_ROUNDS),
            firstName: employee.firstName,
            lastName: employee.lastName,
          },
        });
        userId = user.id;
      }
      const hasRoles = await this.prisma.userRoleAssignment.count({ where: { userId, organizationId } });
      await this.prisma.$transaction([
        this.prisma.membership.upsert({
          where: { userId_organizationId: { userId, organizationId } },
          create: { userId, organizationId },
          update: { isActive: true },
        }),
        ...(hasRoles
          ? []
          : [
              this.prisma.userRoleAssignment.createMany({
                data: roleIds.map((roleId) => ({ userId, roleId, organizationId, assignedById: actorUserId })),
              }),
            ]),
      ]);
    }

    await this.prisma.employee.update({ where: { id: employeeId }, data: { userId } });
    await this.audit(organizationId, actorUserId, 'employee.login_granted', employeeId, { userId, linkedExistingLogin });
    // A brand-new login is welcomed; an existing one linked from another
    // company is told they've been added. Linking a login already in this
    // company (dto.userId) needs no email.
    if (!dto.userId) this.notify.welcome(organizationId, userId, !linkedExistingLogin);
    return { employeeId, userId, linkedExistingLogin };
  }

  // "Forgot my password" until email-based reset exists: HR sets a new
  // temporary password and shares it. Your own password goes through
  // POST /auth/change-password instead, which checks the current one.
  async resetPassword(organizationId: string, actorUserId: string, userId: string, newPassword: string) {
    await this.findUser(organizationId, userId);
    if (userId === actorUserId) {
      throw new BadRequestException('Use "Change password" for your own account');
    }
    // Resetting a password shared with other companies would let one company
    // take over someone's access to the others.
    const elsewhere = await this.prisma.membership.count({
      where: { userId, isActive: true, organizationId: { not: organizationId } },
    });
    if (elsewhere > 0) {
      throw new BadRequestException(
        'This person also works for other companies, so only they can change their password (My account → Change password).',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) },
    });
    await this.audit(organizationId, actorUserId, 'user.password_reset', userId, {});
    return { reset: true };
  }

  private async employeeRoleId(organizationId: string) {
    const role = await this.prisma.role.findFirst({
      where: { organizationId, name: 'Employee', isSystemRole: true },
    });
    if (!role) throw new BadRequestException('No "Employee" role exists in this organization');
    return role.id;
  }

  private async findUser(organizationId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, memberships: { some: { organizationId } } },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async assertRolesInOrg(organizationId: string, roleIds: string[]) {
    const count = await this.prisma.role.count({ where: { organizationId, id: { in: roleIds } } });
    if (count !== roleIds.length) throw new BadRequestException('One or more roles were not found');
  }

  private audit(organizationId: string, actorUserId: string, eventType: string, entityId: string, metadata: any) {
    return this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        eventType,
        entityType: eventType.startsWith('employee') ? 'Employee' : 'User',
        entityId,
        metadata,
      },
    });
  }
}
