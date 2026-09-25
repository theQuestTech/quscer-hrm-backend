import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { findActiveMembership } from '../common/membership';
import { sniffImageType } from '../feed/feed.service';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// Profile photos. Anyone in the company can see them (they appear on
// dashboards and the feed); HR can change anyone's, and everyone can change
// their own.
@Controller('employees/:id/photo')
@UseGuards(JwtAuthGuard)
export class PhotoController {
  constructor(
    private prisma: PrismaService,
    private rbac: RbacService,
  ) {}

  private async employeeInCompany(req: any, id: string) {
    if (!(await findActiveMembership(this.prisma, req.user.id, req.user.organizationId))) {
      throw new ForbiddenException("You don't have access to this company");
    }
    const employee = await this.prisma.employee.findFirst({ where: { id, organizationId: req.user.organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  private async assertCanChange(req: any, employee: { userId: string | null }) {
    if (employee.userId === req.user.id) return;
    const permissions = await this.rbac.getEffectivePermissions(req.user.id, req.user.organizationId);
    if (!permissions.has('hrm.employee.write')) {
      throw new ForbiddenException('You can only change your own photo');
    }
  }

  @Get()
  async get(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    await this.employeeInCompany(req, id);
    const photo = await this.prisma.employeePhoto.findUnique({ where: { employeeId: id } });
    if (!photo) throw new NotFoundException('No photo');
    res.set({
      'Content-Type': photo.mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    });
    res.send(Buffer.from(photo.data));
  }

  // multipart/form-data with one "photo" file.
  @Put()
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES + 1, files: 1 } }))
  async put(@Req() req: any, @Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    const employee = await this.employeeInCompany(req, id);
    await this.assertCanChange(req, employee);
    if (!file) throw new BadRequestException('Choose a photo');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('Photos can be at most 2 MB');
    const mimeType = sniffImageType(file.buffer);
    if (!mimeType) throw new BadRequestException('Photos must be JPG, PNG or WebP');
    const photoUpdatedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.employeePhoto.upsert({
        where: { employeeId: id },
        create: { employeeId: id, mimeType, data: file.buffer },
        update: { mimeType, data: file.buffer },
      }),
      this.prisma.employee.update({ where: { id }, data: { photoUpdatedAt } }),
    ]);
    return { photoUpdatedAt };
  }

  @Delete()
  async remove(@Req() req: any, @Param('id') id: string) {
    const employee = await this.employeeInCompany(req, id);
    await this.assertCanChange(req, employee);
    await this.prisma.$transaction([
      this.prisma.employeePhoto.deleteMany({ where: { employeeId: id } }),
      this.prisma.employee.update({ where: { id }, data: { photoUpdatedAt: null } }),
    ]);
    return { photoUpdatedAt: null };
  }
}
