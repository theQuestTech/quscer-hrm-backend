// DELIBERATELY MINIMAL. This exists only so the JwtAuthGuard/PermissionGuard
// chain is testable end-to-end before Quscer OS SSO connects (WBS 6.1).
// No password reset, no email verification, no "remember me" — don't build
// those here. When 6.1 lands, this whole module gets replaced by shared
// Quscer session validation, not hardened into a real auth system.

import {
  BadRequestException,
  ConflictException,
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

const SALT_ROUNDS = 10;

// Starter leave catalog for a new organization, editable afterwards in
// Settings. Day counts follow the Pakistan Factories Act defaults (14 annual,
// 10 casual, 16 sick) — the org's own policy may differ.
const DEFAULT_LEAVE_TYPES = [
  { name: 'Annual', isPaid: true, defaultAnnualDays: 14 },
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

  async signup(dto: SignupDto) {
    // The Permission catalog must already exist (via `npm run prisma:seed`)
    // or the new org's roles get created with zero permissions attached,
    // silently locking the first user out of everything. Fail loudly
    // instead of guessing.
    const permissionCount = await this.prisma.permission.count();
    if (permissionCount === 0) {
      throw new InternalServerErrorException(
        'Permission catalog is empty — run `npm run prisma:seed` before allowing signups.',
      );
    }

    const organization = await this.prisma.organization.create({
      data: { name: dto.organizationName },
    });

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          organizationId: organization.id,
          email: dto.email.toLowerCase(),
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('Email already in use for this organization');
      }
      throw e;
    }

    const roleIds = await this.rbacService.seedDefaultRolesForOrganization(
      organization.id,
    );

    // First user of a new org is the HR Admin AND the Payroll Approver —
    // otherwise nobody in a brand-new org can run payroll or hand out the
    // role that does. They can split these across people later in Settings.
    await this.prisma.userRoleAssignment.createMany({
      data: ['HR Admin', 'Payroll Approver'].map((roleName) => ({
        userId: user.id,
        roleId: roleIds[roleName],
        organizationId: organization.id,
      })),
    });

    await this.prisma.organizationLocaleSettings.create({
      data: {
        organizationId: organization.id,
        defaultCountryCode: 'PK',
        defaultCurrency: 'PKR',
        defaultTimezone: 'Asia/Karachi',
        loadedStatutoryPacks: ['PK'],
      },
    });

    await this.prisma.leaveType.createMany({
      data: DEFAULT_LEAVE_TYPES.map((t) => ({ organizationId: organization.id, ...t })),
    });

    return this.issueToken(user.id, organization.id, user.email);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), isActive: true },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueToken(user.id, user.organizationId, user.email);
  }

  // Everything the frontend needs to render the right screens for this user:
  // who they are, their org, their effective permissions, and the employee
  // record (if any) that self-service features act on.
  async me(userId: string, organizationId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId, isActive: true },
      include: {
        organization: { include: { localeSettings: true } },
        roleAssignments: { include: { role: true } },
      },
    });
    if (!user) throw new UnauthorizedException('User not found or inactive');

    const permissions = await this.rbacService.getEffectivePermissions(userId, organizationId);
    const employee = await findEmployeeForUser(this.prisma, organizationId, userId);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
