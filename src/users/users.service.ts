// WBS 1.8 (role assignment) and a minimal slice of 2.8 (give an employee a
// login). This is not the invitation/activation flow — HR sets a starting
// password and shares it — because auth is replaced by Quscer OS later
// (WBS 6.1) and shouldn't grow email flows before then.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { GrantLoginAccessDto } from './users.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  listRoles(organizationId: string) {
    return this.prisma.role.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async listUsers(organizationId: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: { roleAssignments: { include: { role: true } } },
    });
    const employees = await this.prisma.employee.findMany({
      where: { organizationId, userId: { in: users.map((u) => u.id) } },
      select: { id: true, userId: true, firstName: true, lastName: true, employeeNumber: true },
    });
    return users.map(({ passwordHash, roleAssignments, ...user }) => ({
      ...user,
      roles: roleAssignments.map((a) => ({ id: a.role.id, name: a.role.name })),
      employee: employees.find((e) => e.userId === user.id) ?? null,
    }));
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
    await this.prisma.user.update({ where: { id: userId }, data: { isActive } });
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
      try {
        const user = await this.prisma.user.create({
          data: {
            organizationId,
            email: employee.email.toLowerCase(),
            passwordHash: await bcrypt.hash(dto.password!, SALT_ROUNDS),
            firstName: employee.firstName,
            lastName: employee.lastName,
          },
        });
        userId = user.id;
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw new ConflictException(
            `A login with ${employee.email} already exists — link it with userId instead`,
          );
        }
        throw e;
      }
      await this.prisma.userRoleAssignment.createMany({
        data: roleIds.map((roleId) => ({ userId, roleId, organizationId, assignedById: actorUserId })),
      });
    }

    await this.prisma.employee.update({ where: { id: employeeId }, data: { userId } });
    await this.audit(organizationId, actorUserId, 'employee.login_granted', employeeId, { userId });
    return { employeeId, userId };
  }

  // "Forgot my password" until email-based reset exists: HR sets a new
  // temporary password and shares it. Your own password goes through
  // POST /auth/change-password instead, which checks the current one.
  async resetPassword(organizationId: string, actorUserId: string, userId: string, newPassword: string) {
    await this.findUser(organizationId, userId);
    if (userId === actorUserId) {
      throw new BadRequestException('Use "Change password" for your own account');
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
