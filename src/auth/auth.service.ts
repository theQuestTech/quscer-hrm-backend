// DELIBERATELY MINIMAL. This exists only so the JwtAuthGuard/PermissionGuard
// chain is testable end-to-end before Quscer OS SSO connects (WBS 6.1).
// No password reset, no email verification, no "remember me" — don't build
// those here. When 6.1 lands, this whole module gets replaced by shared
// Quscer session validation, not hardened into a real auth system.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { findEmployeeForUser } from '../common/current-employee';
import { findActiveMembership } from '../common/membership';

const SALT_ROUNDS = 10;

// Starter leave catalog for a new organization, editable afterwards in
// Settings. Day counts follow the Pakistan Factories Act defaults (14 annual,
// 10 casual, 16 sick) — the org's own policy may differ.
const DEFAULT_LEAVE_TYPES = [
  { name: 'Annual', isPaid: true, defaultAnnualDays: 14, isEncashable: true },
  { name: 'Casual', isPaid: true, defaultAnnualDays: 10 },
  { name: 'Sick', isPaid: true, defaultAnnualDays: 16 },
  { name: 'Unpaid', isPaid: false, defaultAnnualDays: 0 },
];

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private rbacService: RbacService,
  ) {}

  // A new company plus its first login. One email is one login across the
  // whole system: someone who already has a login adds another company from
  // their account instead (addCompany) and switches between them.
  async signup(dto: SignupDto) {
    this.assertPermissionCatalog(await this.prisma.permission.count());
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findFirst({ where: { email } })) {
      throw new ConflictException(
        'An account with this email already exists. Sign in instead — you can add another company from "My account".',
      );
    }

    const organization = await this.prisma.organization.create({
      data: { name: dto.organizationName },
    });
    const user = await this.prisma.user.create({
      data: {
        organizationId: organization.id,
        email,
        passwordHash: await bcrypt.hash(dto.password, SALT_ROUNDS),
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });
    await this.setUpOrganization(organization.id, user.id);
    return this.issueToken(user.id, organization.id, user.email);
  }

  // Outsourced HR / a group running several companies: the signed-in person
  // creates another company and becomes its HR Admin + Payroll Approver.
  async addCompany(userId: string, currentOrganizationId: string, organizationName: string) {
    this.assertPermissionCatalog(await this.prisma.permission.count());
    if (!(await findActiveMembership(this.prisma, userId, currentOrganizationId))) {
      throw new UnauthorizedException('User not found or inactive');
    }
    // Only an HR admin (company settings) can set up another company.
    const permissions = await this.rbacService.getEffectivePermissions(userId, currentOrganizationId);
    if (!permissions.has('hrm.settings.write')) {
      throw new ForbiddenException('Only HR admins can add a company');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const organization = await this.prisma.organization.create({ data: { name: organizationName } });
    await this.setUpOrganization(organization.id, userId);
    await this.prisma.auditEvent.create({
      data: {
        organizationId: organization.id,
        actorUserId: userId,
        eventType: 'organization.created',
        entityType: 'Organization',
        entityId: organization.id,
        metadata: { fromOrganizationId: currentOrganizationId },
      },
    });
    return this.issueToken(userId, organization.id, user.email);
  }

  // The companies this login can open, for the company switcher.
  async companies(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, isActive: true, user: { isActive: true } },
      include: { organization: { select: { id: true, name: true } } },
    });
    return memberships
      .map((m) => m.organization)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async switchCompany(userId: string, organizationId: string) {
    const membership = await findActiveMembership(this.prisma, userId, organizationId);
    if (!membership) throw new ForbiddenException("You don't have access to that company");
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.issueToken(userId, organizationId, user.email);
  }

  async login(dto: LoginDto) {
    // Older data may hold the same email in more than one company (from
    // before emails were unique) — accept whichever login the password fits.
    const candidates = await this.prisma.user.findMany({
      where: { email: dto.email.toLowerCase(), isActive: true },
      orderBy: { createdAt: 'asc' },
      include: { memberships: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
    });
    for (const user of candidates) {
      if (!user.passwordHash || !(await bcrypt.compare(dto.password, user.passwordHash))) continue;
      // Open their own company if they still have it, else the first other one.
      const membership =
        user.memberships.find((m) => m.organizationId === user.organizationId) ?? user.memberships[0];
      if (!membership) break;
      return this.issueToken(user.id, membership.organizationId, user.email);
    }
    throw new UnauthorizedException('Invalid email or password');
  }

  // Everything the frontend needs to render the right screens for this user:
  // who they are, their org, their effective permissions, and the employee
  // record (if any) that self-service features act on.
  async me(userId: string, organizationId: string) {
    const [user, organization] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId, isActive: true, memberships: { some: { organizationId, isActive: true } } },
        include: { roleAssignments: { where: { organizationId }, include: { role: true } } },
      }),
      this.prisma.organization.findUnique({ where: { id: organizationId }, include: { localeSettings: true } }),
    ]);
    if (!user || !organization) throw new UnauthorizedException('User not found or inactive');

    const permissions = await this.rbacService.getEffectivePermissions(userId, organizationId);
    const employee = await findEmployeeForUser(this.prisma, organizationId, userId);
    // Show Recruitment to hiring managers and interviewers, and Onboarding
    // to new joiners and their managers, even if they aren't HR.
    const [hiringOrInterviewing, onboardingTasks] = employee
      ? await Promise.all([
          this.prisma.jobOpening.count({ where: { organizationId, hiringManagerEmployeeId: employee.id, status: { not: 'DRAFT' } } })
            .then(async (n) => n + (await this.prisma.interview.count({ where: { interviewerEmployeeId: employee.id, status: { not: 'CANCELLED' } } }))),
          this.prisma.onboardingTask.count({
            where: { organizationId, OR: [{ employeeId: employee.id }, { employee: { managerId: employee.id } }] },
          }),
        ])
      : [0, 0];

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        currency: organization.localeSettings?.defaultCurrency ?? 'PKR',
        timezone: organization.localeSettings?.defaultTimezone ?? 'Asia/Karachi',
        modules: organization.localeSettings?.enabledModules ?? ['performance', 'training', 'recruitment'],
        kpiScoring: organization.localeSettings?.kpiScoring ?? 'BOTH',
      },
      involvement: { recruiting: hiringOrInterviewing > 0, onboarding: onboardingTasks > 0 },
      companies: await this.companies(userId),
      roles: user.roleAssignments.map((a) => a.role.name),
      permissions: [...permissions].sort(),
      employee: employee && {
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        firstName: employee.firstName,
        lastName: employee.lastName,
        designation: employee.designation,
        photoUpdatedAt: employee.photoUpdatedAt,
      },
    };
  }

  // Signed-in user changes their own password. Existing sessions stay valid
  // until their token expires (JWT_EXPIRES_IN) — there's no session
  // revocation yet (WBS 6.13).
  async changePassword(userId: string, organizationId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true, memberships: { some: { organizationId, isActive: true } } },
    });
    if (!user?.passwordHash || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('The new password must be different from the current one');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, SALT_ROUNDS) },
    });
    await this.prisma.auditEvent.create({
      data: { organizationId, actorUserId: userId, eventType: 'user.password_changed', entityType: 'User', entityId: userId },
    });
    return { changed: true };
  }

  private assertPermissionCatalog(permissionCount: number) {
    // Without the Permission catalog (`npm run prisma:seed`) a new company's
    // roles would have no permissions and lock its first user out. Fail
    // loudly instead.
    if (permissionCount === 0) {
      throw new InternalServerErrorException(
        'Permission catalog is empty — run `npm run prisma:seed` before allowing signups.',
      );
    }
  }

  // Default roles, the first person as HR Admin + Payroll Approver (so a
  // brand-new company can run payroll and hand out roles), their access to
  // it, Pakistan defaults and a starter leave catalog — all editable later.
  private async setUpOrganization(organizationId: string, userId: string) {
    const roleIds = await this.rbacService.seedDefaultRolesForOrganization(organizationId);
    await this.prisma.membership.create({ data: { userId, organizationId } });
    await this.prisma.userRoleAssignment.createMany({
      data: ['HR Admin', 'Payroll Approver'].map((roleName) => ({
        userId,
        roleId: roleIds[roleName],
        organizationId,
      })),
    });
    await this.prisma.organizationLocaleSettings.create({
      data: {
        organizationId,
        defaultCountryCode: 'PK',
        defaultCurrency: 'PKR',
        defaultTimezone: 'Asia/Karachi',
        loadedStatutoryPacks: ['PK'],
      },
    });
    await this.prisma.leaveType.createMany({
      data: DEFAULT_LEAVE_TYPES.map((t) => ({ organizationId, ...t })),
    });
  }

  private async issueToken(userId: string, organizationId: string, email: string) {
    const accessToken = await this.jwtService.signAsync({
      id: userId,
      organizationId,
      email,
    });
    return { accessToken };
  }
}
