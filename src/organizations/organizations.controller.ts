import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermission } from '../rbac/permission.guard';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private organizationsService: OrganizationsService) {}

  // First real end-to-end example: requires a valid JWT AND the
  // "hrm.settings.write" permission via the user's assigned role(s).
  // Swap the permission key per-route as real endpoints get built out.
  @Get('me')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('hrm.settings.write')
  async getMyOrganization(@Req() request: any) {
    const organizationId = request.user.organizationId;
    return this.organizationsService.getOrganizationWithLocale(organizationId);
  }
}
