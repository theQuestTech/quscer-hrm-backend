// Onboarding — the joining checklist.
//   HR keeps the company's checklist (templates). Starting onboarding for a
//   new joiner copies the active items onto them, each due a number of days
//   from their joining date. A task is ticked off by whoever it belongs to:
//   HR, the new joiner's manager, or the new joiner. HR can tick any task.

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OnboardingAssignee, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { Caller, callerAccess } from '../common/caller-access';
import { startOfDayUtc } from '../common/dates';
import { TaskDto, TemplateDto } from './onboarding.dto';

const DAY = 24 * 60 * 60 * 1000;

// A sensible starting checklist for a Pakistani company; HR edits it.
export const SUGGESTED_CHECKLIST: { title: string; assignee: OnboardingAssignee; dueDays: number; description?: string }[] = [
  { title: 'Prepare and share the appointment letter', assignee: 'HR', dueDays: -3 },
  { title: 'Set up email, laptop and system access', assignee: 'HR', dueDays: -1 },
  { title: 'Welcome meeting and introduce the team', assignee: 'MANAGER', dueDays: 0 },
  { title: 'Upload a copy of your CNIC', assignee: 'EMPLOYEE', dueDays: 0, description: 'Add it under My Profile → Documents.' },
  { title: 'Fill in personal details and an emergency contact', assignee: 'EMPLOYEE', dueDays: 1, description: 'In My Profile.' },
  { title: 'Upload educational and experience certificates', assignee: 'EMPLOYEE', dueDays: 3 },
  { title: 'Read and sign the company handbook', assignee: 'EMPLOYEE', dueDays: 3 },
  { title: 'Add to payroll and confirm bank details', assignee: 'HR', dueDays: 7 },
  { title: "Agree the first month's goals", assignee: 'MANAGER', dueDays: 7 },
  { title: 'Register with EOBI and provincial social security', assignee: 'HR', dueDays: 30 },
  { title: 'End-of-probation check-in', assignee: 'MANAGER', dueDays: 90 },
];

export function dueDateFor(joining: Date, dueDays: number): Date {
  return new Date(startOfDayUtc(joining).getTime() + dueDays * DAY);
}

const person = { select: { id: true, firstName: true, lastName: true, designation: true, photoUpdatedAt: true, dateOfJoining: true, managerId: true } } as const;

@Injectable()
export class OnboardingService {
  constructor(
    private prisma: PrismaService,
    private rbac: RbacService,
  ) {}

  private async requireHr(caller: Caller) {
    const a = await callerAccess(this.prisma, this.rbac, caller);
    if (!a.isHr) throw new ForbiddenException('Only HR can do this');
    return a;
  }

  // --- The company's checklist ---------------------------------------------

  async listTemplates(caller: Caller) {
    await this.requireHr(caller);
    return this.prisma.onboardingTaskTemplate.findMany({
      where: { organizationId: caller.organizationId },
      orderBy: [{ isActive: 'desc' }, { dueDays: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createTemplate(caller: Caller, dto: TemplateDto) {
    await this.requireHr(caller);
    return this.prisma.onboardingTaskTemplate.create({ data: { organizationId: caller.organizationId, ...dto } });
  }

  async updateTemplate(caller: Caller, id: string, dto: Partial<TemplateDto>) {
    await this.requireHr(caller);
    await this.findTemplate(caller.organizationId, id);
    return this.prisma.onboardingTaskTemplate.update({ where: { id }, data: dto });
  }

  async removeTemplate(caller: Caller, id: string) {
    await this.requireHr(caller);
    await this.findTemplate(caller.organizationId, id);
    await this.prisma.onboardingTaskTemplate.delete({ where: { id } });
    return { ok: true };
  }

  async addSuggested(caller: Caller) {
    await this.requireHr(caller);
    const existing = await this.prisma.onboardingTaskTemplate.count({ where: { organizationId: caller.organizationId } });
    if (existing) throw new ConflictException('Your checklist already has items');
    await this.prisma.onboardingTaskTemplate.createMany({
      data: SUGGESTED_CHECKLIST.map((t) => ({ organizationId: caller.organizationId, ...t })),
    });
    return this.listTemplates(caller);
  }

  private async findTemplate(organizationId: string, id: string) {
    const t = await this.prisma.onboardingTaskTemplate.findFirst({ where: { id, organizationId } });
    if (!t) throw new NotFoundException('Checklist item not found');
    return t;
  }

  // --- A new joiner's tasks -------------------------------------------------

  // Copies the active checklist onto one employee. Used by "Start onboarding"
  // and by Hire (with an actor already checked).
  async startFor(organizationId: string, actorUserId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (await this.prisma.onboardingTask.count({ where: { employeeId } })) {
      throw new ConflictException('Onboarding has already started for this person');
    }
    const templates = await this.prisma.onboardingTaskTemplate.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ dueDays: 'asc' }, { createdAt: 'asc' }],
    });
    if (!templates.length) throw new ConflictException('Your onboarding checklist is empty — add items in Onboarding → Checklist first');
    await this.prisma.onboardingTask.createMany({
      data: templates.map((t, i) => ({
        organizationId,
        employeeId,
        title: t.title,
        description: t.description,
        assignee: t.assignee,
        dueDate: dueDateFor(employee.dateOfJoining, t.dueDays),
        position: i,
      })),
    });
    await this.audit(organizationId, actorUserId, 'onboarding.started', employeeId, { employeeId, tasks: templates.length });
    return { created: templates.length };
  }

  async start(caller: Caller, employeeId: string) {
    await this.requireHr(caller);
    await this.startFor(caller.organizationId, caller.id, employeeId);
    return this.forEmployee(caller, employeeId);
  }

  // Everyone being onboarded, with progress. HR sees all; a manager sees
  // their direct reports.
  async overview(caller: Caller) {
    const a = await callerAccess(this.prisma, this.rbac, caller);
    if (!a.isHr && !a.own) return [];
    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId: caller.organizationId,
        onboardingTasks: { some: {} },
        ...(a.isHr ? {} : { managerId: a.own!.id }),
      },
      select: { ...person.select, onboardingTasks: { select: { doneAt: true, dueDate: true } } },
      orderBy: { dateOfJoining: 'desc' },
    });
    const today = startOfDayUtc(new Date());
    return employees.map(({ onboardingTasks, ...e }) => ({
      employee: e,
      total: onboardingTasks.length,
      done: onboardingTasks.filter((t) => t.doneAt).length,
      overdue: onboardingTasks.filter((t) => !t.doneAt && t.dueDate < today).length,
    }));
  }

  async forEmployee(caller: Caller, employeeId: string) {
    const a = await callerAccess(this.prisma, this.rbac, caller);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: caller.organizationId },
      ...person,
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const isSelf = a.own?.id === employee.id;
    const isManager = !!a.own && employee.managerId === a.own.id;
    if (!a.isHr && !isSelf && !isManager) throw new ForbiddenException("You can't see this person's onboarding");
    const tasks = await this.prisma.onboardingTask.findMany({
      where: { employeeId },
      orderBy: [{ dueDate: 'asc' }, { position: 'asc' }],
    });
    return {
      employee,
      canManage: a.isHr,
      tasks: tasks.map((t) => ({ ...t, canTick: this.canTick(a, t.assignee, isSelf, isManager) })),
    };
  }

  // What I need to do: my own joining tasks, my new team members' manager
  // tasks, and (for HR) every open HR task.
  async mine(caller: Caller) {
    const a = await callerAccess(this.prisma, this.rbac, caller);
    const or: Prisma.OnboardingTaskWhereInput[] = [];
    if (a.own) {
      or.push({ employeeId: a.own.id, assignee: OnboardingAssignee.EMPLOYEE });
      or.push({ assignee: OnboardingAssignee.MANAGER, employee: { managerId: a.own.id } });
    }
    if (a.isHr) or.push({ assignee: OnboardingAssignee.HR });
    if (!or.length) return [];
    const tasks = await this.prisma.onboardingTask.findMany({
      where: { organizationId: caller.organizationId, doneAt: null, OR: or },
      include: { employee: person },
      orderBy: [{ dueDate: 'asc' }, { position: 'asc' }],
      take: 100,
    });
    return tasks.map((t) => ({ ...t, forMe: t.employeeId === a.own?.id }));
  }

  async addTask(caller: Caller, dto: TaskDto) {
    await this.requireHr(caller);
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, organizationId: caller.organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');
    const last = await this.prisma.onboardingTask.aggregate({ where: { employeeId: employee.id }, _max: { position: true } });
    await this.prisma.onboardingTask.create({
      data: {
        organizationId: caller.organizationId,
        employeeId: employee.id,
        title: dto.title,
        description: dto.description,
        assignee: dto.assignee,
        dueDate: new Date(dto.dueDate),
        position: (last._max.position ?? -1) + 1,
      },
    });
    return this.forEmployee(caller, employee.id);
  }

  async setDone(caller: Caller, taskId: string, done: boolean) {
    const a = await callerAccess(this.prisma, this.rbac, caller);
    const task = await this.prisma.onboardingTask.findFirst({
      where: { id: taskId, organizationId: caller.organizationId },
      include: { employee: { select: { id: true, managerId: true } } },
    });
    if (!task) throw new NotFoundException('Task not found');
    const isSelf = a.own?.id === task.employee.id;
    const isManager = !!a.own && task.employee.managerId === a.own.id;
    if (!this.canTick(a, task.assignee, isSelf, isManager)) throw new ForbiddenException("This task isn't yours to tick off");
    const updated = await this.prisma.onboardingTask.update({
      where: { id: taskId },
      data: done ? { doneAt: new Date(), doneByUserId: caller.id } : { doneAt: null, doneByUserId: null },
    });
    if (done) {
      const open = await this.prisma.onboardingTask.count({ where: { employeeId: task.employeeId, doneAt: null } });
      if (open === 0) await this.audit(caller.organizationId, caller.id, 'onboarding.completed', task.employeeId, { employeeId: task.employeeId });
    }
    return updated;
  }

  async removeTask(caller: Caller, taskId: string) {
    await this.requireHr(caller);
    const task = await this.prisma.onboardingTask.findFirst({ where: { id: taskId, organizationId: caller.organizationId } });
    if (!task) throw new NotFoundException('Task not found');
    await this.prisma.onboardingTask.delete({ where: { id: taskId } });
    return { ok: true };
  }

  private canTick(a: { isHr: boolean }, assignee: OnboardingAssignee, isSelf: boolean, isManager: boolean) {
    if (a.isHr) return true;
    if (assignee === OnboardingAssignee.EMPLOYEE) return isSelf;
    if (assignee === OnboardingAssignee.MANAGER) return isManager;
    return false;
  }

  private audit(organizationId: string, actorUserId: string, eventType: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditEvent.create({
      data: { organizationId, actorUserId, eventType, entityType: 'Employee', entityId, metadata },
    });
  }
}
