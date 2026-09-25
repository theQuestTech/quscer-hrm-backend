import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { UsersService } from './users.service';
import { AddPersonDto, GrantLoginAccessDto, ResetPasswordDto, SetUserRolesDto, UpdateUserDto } from './users.dto';

// Who can log in and what they can do is an org-settings concern, so every
// route here needs hrm.settings.write.
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('roles')
  @RequirePermission('hrm.settings.write')
  listRoles(@Req() req: any) {
    return this.usersService.listRoles(req.user.organizationId);
  }

  @Get('users')
  @RequirePermission('hrm.settings.write')
  listUsers(@Req() req: any) {
    return this.usersService.listUsers(req.user.organizationId);
  }

  // Outsourced HR, accountants and others without an employee record.
  @Post('users')
  @RequirePermission('hrm.settings.write')
  addPerson(@Req() req: any, @Body() dto: AddPersonDto) {
    return this.usersService.addPerson(req.user.organizationId, req.user.id, dto);
  }

  @Put('users/:id/roles')
  @RequirePermission('hrm.settings.write')
  setRoles(@Req() req: any, @Param('id') id: string, @Body() dto: SetUserRolesDto) {
    return this.usersService.setRoles(req.user.organizationId, req.user.id, id, dto.roleIds);
  }

  @Patch('users/:id')
  @RequirePermission('hrm.settings.write')
  updateUser(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateUser(req.user.organizationId, req.user.id, id, dto.isActive);
  }

  @Post('users/:id/reset-password')
  @RequirePermission('hrm.settings.write')
  resetPassword(@Req() req: any, @Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(req.user.organizationId, req.user.id, id, dto.newPassword);
  }

  @Post('employees/:id/login-access')
  @RequirePermission('hrm.settings.write')
  grantLoginAccess(@Req() req: any, @Param('id') id: string, @Body() dto: GrantLoginAccessDto) {
    return this.usersService.grantLoginAccess(req.user.organizationId, req.user.id, id, dto);
  }
}
