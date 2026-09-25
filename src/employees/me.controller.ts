import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
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
import { findActiveMembership } from '../common/membership';
import { requireEmployeeForUser } from '../common/current-employee';
import { EmployeesService, MAX_DOCUMENT_BYTES } from './employees.service';
import { SelfProfileDto } from './dto/personal-details.dto';
import { CreateEmergencyContactDto } from './dto/create-emergency-contact.dto';
import { UploadEmployeeDocumentDto } from './dto/create-employee-document.dto';

// My Profile: an employee looking after their own record. They can fill in
// personal details, emergency contacts and their own documents; job
// details, pay and bank account stay with HR.
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private prisma: PrismaService,
    private employees: EmployeesService,
  ) {}

  private async own(req: any) {
    if (!(await findActiveMembership(this.prisma, req.user.id, req.user.organizationId))) {
      throw new ForbiddenException("You don't have access to this company");
    }
    return requireEmployeeForUser(this.prisma, req.user.organizationId, req.user.id);
  }

  @Get('profile')
  async profile(@Req() req: any) {
    const me = await this.own(req);
    return this.employees.findOne(req.user.organizationId, me.id);
  }

  @Patch('profile')
  async update(@Req() req: any, @Body() dto: SelfProfileDto) {
    const me = await this.own(req);
    const { dateOfBirth, ...rest } = dto;
    await this.prisma.employee.update({
      where: { id: me.id },
      data: {
        ...rest,
        ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth === null ? null : new Date(dateOfBirth) }),
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        organizationId: req.user.organizationId,
        actorUserId: req.user.id,
        eventType: 'employee.self_updated',
        entityType: 'Employee',
        entityId: me.id,
        metadata: { changedFields: Object.keys(dto) },
      },
    });
    return this.employees.findOne(req.user.organizationId, me.id);
  }

  @Post('emergency-contacts')
  async addContact(@Req() req: any, @Body() dto: CreateEmergencyContactDto) {
    const me = await this.own(req);
    return this.employees.addEmergencyContact(req.user.organizationId, me.id, dto);
  }

  @Delete('emergency-contacts/:contactId')
  async removeContact(@Req() req: any, @Param('contactId') contactId: string) {
    const me = await this.own(req);
    return this.employees.removeEmergencyContact(req.user.organizationId, me.id, contactId);
  }

  @Post('documents/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1 } }))
  async upload(@Req() req: any, @Body() dto: UploadEmployeeDocumentDto, @UploadedFile() file: Express.Multer.File | undefined) {
    const me = await this.own(req);
    return this.employees.uploadDocument(req.user.organizationId, req.user.id, me.id, dto, file);
  }

  @Get('documents/:documentId/file')
  async download(@Req() req: any, @Param('documentId') documentId: string, @Res() res: Response) {
    const me = await this.own(req);
    const file = await this.employees.downloadDocument(req.user.organizationId, me.id, documentId);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.send(Buffer.from(file.data));
  }
}
