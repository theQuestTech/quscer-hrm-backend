import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private fieldEncryption: FieldEncryptionService,
  ) {}

  // Tenant isolation for references: a branch/department/manager ID from
  // another organization must never be linkable just because it exists.
  private async assertRefsInOrg(
    organizationId: string,
    refs: { branchId?: string; departmentId?: string; managerId?: string },
    selfId?: string,
  ) {
    if (refs.branchId) {
      const found = await this.prisma.branch.count({ where: { id: refs.branchId, organizationId } });
      if (!found) throw new BadRequestException('Branch not found');
    }
    if (refs.departmentId) {
      const found = await this.prisma.department.count({ where: { id: refs.departmentId, organizationId } });
      if (!found) throw new BadRequestException('Department not found');
    }
    if (refs.managerId) {
      if (refs.managerId === selfId) throw new BadRequestException('An employee cannot be their own manager');
      const found = await this.prisma.employee.count({ where: { id: refs.managerId, organizationId } });
      if (!found) throw new BadRequestException('Manager not found');
    }
  }

  // Bank account numbers are stored encrypted and never leave the API —
  // callers only ever see the last four digits.
  private maskBankDetail<T extends { accountNumber: string }>(detail: T | null) {
    if (!detail) return null;
    const { accountNumber, ...rest } = detail;
    return rest;
  }

  async create(
    organizationId: string,
    actorUserId: string,
    dto: CreateEmployeeDto,
  ) {
    // If no countryCode/regionCode given, inherit from the branch — the
    // Phase 4 payroll engine needs SOME jurisdiction to key StatutoryRule
    // lookups against, so don't leave this silently null when a branch
    // already has the answer.
    await this.assertRefsInOrg(organizationId, dto);

    let countryCode = dto.countryCode;
    let regionCode = dto.regionCode;
    if (!countryCode && dto.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
      });
      countryCode = countryCode ?? branch?.countryCode;
      regionCode = regionCode ?? branch?.regionCode ?? undefined;
    }

    let employee;
    try {
      employee = await this.prisma.employee.create({
        data: {
          organizationId,
          employeeNumber: dto.employeeNumber,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          designation: dto.designation,
          employmentType: dto.employmentType,
          dateOfJoining: new Date(dto.dateOfJoining),
          probationEndDate: dto.probationEndDate ? new Date(dto.probationEndDate) : undefined,
          contractEndDate: dto.contractEndDate ? new Date(dto.contractEndDate) : undefined,
          branchId: dto.branchId,
          departmentId: dto.departmentId,
          managerId: dto.managerId,
          countryCode,
          regionCode,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(
          `Employee number "${dto.employeeNumber}" already exists in this organization`,
        );
      }
      throw e;
    }

    await this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        eventType: 'employee.created',
        entityType: 'Employee',
        entityId: employee.id,
        metadata: { employeeNumber: employee.employeeNumber },
      },
    });

    return employee;
  }

  // WBS 2.12 — searchable employee directory, with pagination
  async findAll(organizationId: string, query: QueryEmployeesDto) {
    const where: any = { organizationId };

    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { employeeNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { branch: true, department: true },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async findOne(organizationId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, organizationId }, // organizationId filter is the tenant-isolation guard — see Multi-Country Scaling Risks sheet
      include: {
        branch: true,
        department: true,
        manager: { select: { id: true, firstName: true, lastName: true } },
        directReports: { select: { id: true, firstName: true, lastName: true, designation: true } },
        emergencyContacts: true,
        documents: true,
        bankDetail: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return { ...employee, bankDetail: this.maskBankDetail(employee.bankDetail) };
  }

  async update(
    organizationId: string,
    actorUserId: string,
    id: string,
    dto: UpdateEmployeeDto,
  ) {
    await this.findOne(organizationId, id); // 404s if not found or wrong org
    await this.assertRefsInOrg(organizationId, dto, id);

    const { status, dateOfJoining, probationEndDate, contractEndDate, confirmedAt, ...rest } = dto;
    const toDate = (v?: string | null) => (v === undefined ? undefined : v === null ? null : new Date(v));
    const employee = await this.prisma.employee.update({
      where: { id },
      data: {
        ...rest,
        ...(status && { status }),
        ...(dateOfJoining && { dateOfJoining: new Date(dateOfJoining) }),
        probationEndDate: toDate(probationEndDate),
        contractEndDate: toDate(contractEndDate),
        confirmedAt: toDate(confirmedAt),
      },
    });

    await this.prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        eventType: 'employee.updated',
        entityType: 'Employee',
        entityId: employee.id,
        metadata: { changedFields: Object.keys(dto) },
      },
    });

    return employee;
  }

  // WBS 2.6 — reporting-line hierarchy for one manager (one level down)
  async getDirectReports(organizationId: string, managerId: string) {
    return this.prisma.employee.findMany({
      where: { organizationId, managerId },
      select: { id: true, firstName: true, lastName: true, designation: true, status: true },
    });
  }

  // ---------------------------------------------------------------------
  // WBS 2.3 — emergency contacts, documents, bank details
  // Each method re-checks the employee belongs to this org first, so a
  // caller can't add a contact/document to another tenant's employee by
  // guessing an ID — same tenant-isolation discipline as findOne().
  // ---------------------------------------------------------------------

  async addEmergencyContact(organizationId: string, employeeId: string, dto: any) {
    await this.findOne(organizationId, employeeId);
    return this.prisma.emergencyContact.create({
      data: { employeeId, ...dto },
    });
  }

  async removeEmergencyContact(organizationId: string, employeeId: string, contactId: string) {
    await this.findOne(organizationId, employeeId);
    const contact = await this.prisma.emergencyContact.findFirst({
      where: { id: contactId, employeeId },
    });
    if (!contact) throw new NotFoundException('Emergency contact not found');
    return this.prisma.emergencyContact.delete({ where: { id: contactId } });
  }

  async addDocument(organizationId: string, employeeId: string, dto: any) {
    await this.findOne(organizationId, employeeId);
    return this.prisma.employeeDocument.create({
      data: {
        employeeId,
        category: dto.category,
        fileUrl: dto.fileUrl,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      },
    });
  }

  async removeDocument(organizationId: string, employeeId: string, documentId: string) {
    await this.findOne(organizationId, employeeId);
    const doc = await this.prisma.employeeDocument.findFirst({
      where: { id: documentId, employeeId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return this.prisma.employeeDocument.delete({ where: { id: documentId } });
  }

  // Upsert — WBS calls this "bank details", singular per employee (see
  // EmployeeBankDetail.employeeId @unique in schema).
  async upsertBankDetail(organizationId: string, employeeId: string, dto: any) {
    await this.findOne(organizationId, employeeId);
    const digits = dto.accountNumber.replace(/\s+/g, '');
    const data = {
      bankName: dto.bankName,
      accountTitle: dto.accountTitle,
      branchCode: dto.branchCode,
      accountNumber: this.fieldEncryption.encrypt(digits),
      accountNumberLast4: digits.slice(-4),
    };
    const detail = await this.prisma.employeeBankDetail.upsert({
      where: { employeeId },
      create: { employeeId, ...data },
      update: data,
    });
    return this.maskBankDetail(detail);
  }
}
