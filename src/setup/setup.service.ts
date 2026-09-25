// WBS 1.12 / 1.13 / 1.14 / 3.1 — organization settings and the setup data
// everything else hangs off: branches, departments, cost centres, shifts and
// the holiday calendar. Every lookup is scoped by organizationId, and any
// referenced branch/department must belong to the same org — an ID from
// another tenant is treated as "not found", never linked.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDayUtc } from '../common/dates';
import {
  CreateBranchDto,
  CreateCostCentreDto,
  CreateDepartmentDto,
  CreateHolidayDto,
  CreateShiftDto,
  UpdateBranchDto,
  UpdateCostCentreDto,
  UpdateDepartmentDto,
  UpdateOrganizationSettingsDto,
  UpdateShiftDto,
} from './dto/setup.dto';

function assertTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new BadRequestException(`Unknown timezone "${timeZone}" — use an IANA name like Asia/Karachi`);
  }
}

// Employee.branchId/departmentId are optional relations, so the database
// would silently null them out on delete — callers check usage first and
// refuse. This wrapper catches the remaining FK failures (e.g. a branch
// still referenced by departments) and reports them as a 409, not a 500.
async function deleteOrConflict<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new ConflictException(`This ${what} is still in use — reassign or deactivate it instead`);
    }
    throw e;
  }
}

@Injectable()
export class SetupService {
  constructor(private prisma: PrismaService) {}

  // --- Organization settings -------------------------------------------

  async getSettings(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { localeSettings: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  async updateSettings(organizationId: string, dto: UpdateOrganizationSettingsDto) {
    const { name, ...locale } = dto;
    if (locale.defaultTimezone) assertTimeZone(locale.defaultTimezone);

    if (name) {
      await this.prisma.organization.update({ where: { id: organizationId }, data: { name } });
    }
    if (Object.keys(locale).length > 0) {
      await this.prisma.organizationLocaleSettings.upsert({
        where: { organizationId },
        create: {
          organizationId,
          defaultCountryCode: locale.defaultCountryCode ?? 'PK',
          defaultCurrency: locale.defaultCurrency ?? 'PKR',
          defaultTimezone: locale.defaultTimezone ?? 'Asia/Karachi',
          loadedStatutoryPacks: ['PK'],
          ...locale,
        },
        update: locale,
      });
    }
    return this.getSettings(organizationId);
  }

  // --- Branches ---------------------------------------------------------

  listBranches(organizationId: string) {
    return this.prisma.branch.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } } },
    });
  }

  createBranch(organizationId: string, dto: CreateBranchDto) {
    assertTimeZone(dto.timezone);
    return this.prisma.branch.create({ data: { organizationId, ...dto } });
  }

  async updateBranch(organizationId: string, id: string, dto: UpdateBranchDto) {
    await this.findBranch(organizationId, id);
    if (dto.timezone) assertTimeZone(dto.timezone);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async deleteBranch(organizationId: string, id: string) {
    await this.findBranch(organizationId, id);
    await this.assertUnused('branch', { branchId: id });
    return deleteOrConflict('branch', () => this.prisma.branch.delete({ where: { id } }));
  }

  async findBranch(organizationId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, organizationId } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private async assertUnused(what: string, where: { branchId?: string; departmentId?: string }) {
    const employees = await this.prisma.employee.count({ where });
    if (employees > 0) {
      throw new ConflictException(
        `This ${what} still has ${employees} employee(s) — move them first${what === 'branch' ? ' or deactivate the branch' : ''}`,
      );
    }
  }

  // --- Departments ------------------------------------------------------

  listDepartments(organizationId: string) {
    return this.prisma.department.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: { branch: { select: { id: true, name: true } }, _count: { select: { employees: true } } },
    });
  }

  async createDepartment(organizationId: string, dto: CreateDepartmentDto) {
    await this.checkDepartmentRefs(organizationId, dto);
    return this.prisma.department.create({ data: { organizationId, ...dto } });
  }

  async updateDepartment(organizationId: string, id: string, dto: UpdateDepartmentDto) {
    await this.findDepartment(organizationId, id);
    if (dto.parentId === id) throw new BadRequestException('A department cannot be its own parent');
    await this.checkDepartmentRefs(organizationId, dto);
    return this.prisma.department.update({ where: { id }, data: dto });
  }

  async deleteDepartment(organizationId: string, id: string) {
    await this.findDepartment(organizationId, id);
    const children = await this.prisma.department.count({ where: { organizationId, parentId: id } });
    if (children > 0) throw new ConflictException('Move or delete its sub-departments first');
    await this.assertUnused('department', { departmentId: id });
    return deleteOrConflict('department', () => this.prisma.department.delete({ where: { id } }));
  }

  private async findDepartment(organizationId: string, id: string) {
    const department = await this.prisma.department.findFirst({ where: { id, organizationId } });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  private async checkDepartmentRefs(organizationId: string, dto: UpdateDepartmentDto) {
    if (dto.branchId) await this.findBranch(organizationId, dto.branchId);
    if (dto.parentId) await this.findDepartment(organizationId, dto.parentId);
  }

  // --- Cost centres -----------------------------------------------------

  listCostCentres(organizationId: string) {
    return this.prisma.costCentre.findMany({
      where: { organizationId },
      orderBy: { code: 'asc' },
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async createCostCentre(organizationId: string, dto: CreateCostCentreDto) {
    if (dto.branchId) await this.findBranch(organizationId, dto.branchId);
    try {
      return await this.prisma.costCentre.create({ data: { organizationId, ...dto } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`Cost centre code "${dto.code}" already exists`);
      throw e;
    }
  }

  async updateCostCentre(organizationId: string, id: string, dto: UpdateCostCentreDto) {
    await this.findCostCentre(organizationId, id);
    if (dto.branchId) await this.findBranch(organizationId, dto.branchId);
    try {
      return await this.prisma.costCentre.update({ where: { id }, data: dto });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(`Cost centre code "${dto.code}" already exists`);
      throw e;
    }
  }

  async deleteCostCentre(organizationId: string, id: string) {
    await this.findCostCentre(organizationId, id);
    return this.prisma.costCentre.delete({ where: { id } });
  }

  private async findCostCentre(organizationId: string, id: string) {
    const costCentre = await this.prisma.costCentre.findFirst({ where: { id, organizationId } });
    if (!costCentre) throw new NotFoundException('Cost centre not found');
    return costCentre;
  }

  // --- Shifts -----------------------------------------------------------

  listShifts(organizationId: string) {
    return this.prisma.shift.findMany({ where: { organizationId }, orderBy: { startTime: 'asc' } });
  }

  createShift(organizationId: string, dto: CreateShiftDto) {
    return this.prisma.shift.create({ data: { organizationId, ...dto } });
  }

  async updateShift(organizationId: string, id: string, dto: UpdateShiftDto) {
    await this.findShift(organizationId, id);
    return this.prisma.shift.update({ where: { id }, data: dto });
  }

  async deleteShift(organizationId: string, id: string) {
    await this.findShift(organizationId, id);
    return this.prisma.shift.delete({ where: { id } });
  }

  private async findShift(organizationId: string, id: string) {
    const shift = await this.prisma.shift.findFirst({ where: { id, organizationId } });
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  // --- Holidays ---------------------------------------------------------

  listHolidays(organizationId: string, from?: string, to?: string) {
    return this.prisma.holiday.findMany({
      where: {
        organizationId,
        ...(from || to
          ? {
              date: {
                ...(from && { gte: startOfDayUtc(new Date(from)) }),
                ...(to && { lte: startOfDayUtc(new Date(to)) }),
              },
            }
          : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  async createHoliday(organizationId: string, dto: CreateHolidayDto) {
    if (dto.branchId) await this.findBranch(organizationId, dto.branchId);
    return this.prisma.holiday.create({
      data: {
        organizationId,
        name: dto.name,
        branchId: dto.branchId,
        date: startOfDayUtc(new Date(dto.date)),
      },
    });
  }

  async deleteHoliday(organizationId: string, id: string) {
    const holiday = await this.prisma.holiday.findFirst({ where: { id, organizationId } });
    if (!holiday) throw new NotFoundException('Holiday not found');
    return this.prisma.holiday.delete({ where: { id } });
  }

}
