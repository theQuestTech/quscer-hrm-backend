// DELIBERATELY MINIMAL. This exists only so the JwtAuthGuard/PermissionGuard
// chain is testable end-to-end before Quscer OS SSO connects (WBS 6.1).
// No password reset, no email verification, no "remember me" — don't build
// those here. When 6.1 lands, this whole module gets replaced by shared
// Quscer session validation, not hardened into a real auth system.

import {
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

const SALT_ROUNDS = 10;

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

    // First user of a new org is always the HR Admin.
    await this.prisma.userRoleAssignment.create({
      data: {
        userId: user.id,
        roleId: roleIds['HR Admin'],
        organizationId: organization.id,
      },
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

  private async issueToken(userId: string, organizationId: string, email: string) {
    const accessToken = await this.jwtService.signAsync({
      id: userId,
      organizationId,
      email,
    });
    return { accessToken };
  }
}
