// Training.
//   HR (edits employees or company settings) keeps the course list, plans
//   sessions, enrols people and marks who completed — which credits hours and,
//   for courses with a validity, gives a certificate that expires. HR can also
//   record training done elsewhere. A manager sees their direct reports'
//   training and decides their training requests. Everyone sees their own.

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrolmentStatus, Prisma, TrainingRequestStatus, TrainingSessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { Caller, callerAccess } from '../common/caller-access';
import { startOfDayUtc } from '../common/dates';
import {
  CompleteDto, CourseDto, DecideDto, EnrolDto, ExternalRecordDto, FeedbackDto, RequestDto, SessionDto, UpdateSessionDto,
} from './training.dto';
import { EXPIRING_SOON_DAYS, certificateExpiry, certificateState, creditedHours, seatsLeft } from './training-rules';
import { certificatePdf } from './certificate';
import { NotifyService } from '../notifications/notify.service';

const person = { select: { id: true, firstName: true, lastName: true, designation: true, photoUpdatedAt: true, departmentId: true, managerId: true } } as const;
const courseRef = { select: { id: true, title: true, category: true, delivery: true, validityMonths: true, durationHours: true } } as const;
const sessionRef = { select: { id: true, startsAt: true, endsAt: true, location: true, trainer: true, status: true } } as const;
const DAY = 24 * 60 * 60 * 1000;

type Access = Awaited<ReturnType<typeof callerAccess>>;

@Injectable()
export class TrainingService {
  constructor(
    private prisma: PrismaService,
    private rbac: RbacService,
    private notify: NotifyService,
  ) {}

  // --- Access ---------------------------------------------------------------

  private async access(caller: Caller) {
    const a = await callerAccess(this.prisma, this.rbac, caller);
    const s = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId: caller.organizationId } });
    if (!(s?.enabledModules ?? ['performance', 'training', 'recruitment']).includes('training')) {
      throw new ForbiddenException('Training is turned off for this company. HR can turn it on in Settings.');
    }
    return a;
  }

  private async requireHr(caller: Caller) {
    const a = await this.access(caller);
    if (!a.isHr) throw new ForbiddenException('Only HR can do this');
    return a;
  }

  // HR, the person themselves, or their manager.
  private async assertCanSee(caller: Caller, a: Access, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId: caller.organizationId }, ...person });
    if (!employee) throw new NotFoundException('Employee not found');
    const isSelf = a.own?.id === employee.id;
    const isManager = !!a.own && employee.managerId === a.own.id;
    if (!a.isHr && !isSelf && !isManager) throw new ForbiddenException("You can't see this person's training");
    return { employee, isSelf, isManager };
  }

  // --- Courses --------------------------------------------------------------

  async listCourses(caller: Caller) {
    const a = await this.access(caller);
    const courses = await this.prisma.trainingCourse.findMany({
      where: { organizationId: caller.organizationId, ...(a.isHr ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
    });
    if (!a.isHr) return courses.map(({ costPerPerson, ...c }) => c);
    return courses;
  }

  async createCourse(caller: Caller, dto: CourseDto) {
    await this.requireHr(caller);
    const course = await this.prisma.trainingCourse.create({ data: { organizationId: caller.organizationId, ...dto } });
    await this.audit(caller, 'training.course_created', 'TrainingCourse', course.id, { title: course.title });
    return course;
  }

  async updateCourse(caller: Caller, id: string, dto: Partial<CourseDto>) {
    await this.requireHr(caller);
    await this.findCourse(caller.organizationId, id);
    return this.prisma.trainingCourse.update({ where: { id }, data: dto });
  }

  private async findCourse(organizationId: string, id: string) {
    const course = await this.prisma.trainingCourse.findFirst({ where: { id, organizationId } });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  // --- Sessions -------------------------------------------------------------

  async listSessions(caller: Caller, when: 'upcoming' | 'past') {
    await this.requireHr(caller);
    const today = startOfDayUtc(new Date());
    const sessions = await this.prisma.trainingSession.findMany({
      where: {
        organizationId: caller.organizationId,
        ...(when === 'upcoming'
          ? { status: TrainingSessionStatus.PLANNED, endsAt: { gte: today } }
          : { OR: [{ status: { not: TrainingSessionStatus.PLANNED } }, { endsAt: { lt: today } }] }),
      },
      include: { course: courseRef, enrolments: { select: { status: true } } },
      orderBy: { startsAt: when === 'upcoming' ? 'asc' : 'desc' },
      take: 100,
    });
    return sessions.map(({ enrolments, ...s }) => ({
      ...s,
      enrolled: enrolments.filter((e) => e.status !== EnrolmentStatus.CANCELLED).length,
      completed: enrolments.filter((e) => e.status === EnrolmentStatus.COMPLETED).length,
    }));
  }

  async createSession(caller: Caller, dto: SessionDto) {
    await this.requireHr(caller);
    const course = await this.findCourse(caller.organizationId, dto.courseId);
    if (!course.isActive) throw new BadRequestException('This course is not in use');
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('The session must end after it starts');
    const session = await this.prisma.trainingSession.create({
      data: {
        organizationId: caller.organizationId,
        courseId: course.id,
        startsAt,
        endsAt,
        location: dto.location?.trim() || null,
        trainer: dto.trainer?.trim() || null,
        capacity: dto.capacity ?? null,
      },
    });
    await this.audit(caller, 'training.session_planned', 'TrainingSession', session.id, { course: course.title });
    return session;
  }

  async getSession(caller: Caller, id: string) {
    await this.requireHr(caller);
    const session = await this.prisma.trainingSession.findFirst({
      where: { id, organizationId: caller.organizationId },
      include: {
        course: true,
        enrolments: { include: { employee: person }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    const active = session.enrolments.filter((e) => e.status !== EnrolmentStatus.CANCELLED).length;
    // People who asked for this course and are waiting to be booked.
    const waiting = await this.prisma.trainingRequest.findMany({
      where: { organizationId: caller.organizationId, courseId: session.courseId, status: TrainingRequestStatus.APPROVED },
      include: { employee: person },
    });
    return { ...session, seatsLeft: seatsLeft(session.capacity, active), waiting };
  }

  async updateSession(caller: Caller, id: string, dto: UpdateSessionDto) {
    await this.requireHr(caller);
    const session = await this.findSession(caller.organizationId, id);
    if (session.status !== TrainingSessionStatus.PLANNED) throw new BadRequestException('Only planned sessions can be changed');
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : session.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : session.endsAt;
    if (endsAt <= startsAt) throw new BadRequestException('The session must end after it starts');
    await this.prisma.trainingSession.update({
      where: { id },
      data: {
        startsAt,
        endsAt,
        ...(dto.location !== undefined && { location: dto.location?.trim() || null }),
        ...(dto.trainer !== undefined && { trainer: dto.trainer?.trim() || null }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.status && { status: dto.status }),
      },
    });
    if (dto.status === TrainingSessionStatus.CANCELLED) {
      await this.prisma.trainingEnrolment.updateMany({
        where: { sessionId: id, status: EnrolmentStatus.ENROLLED },
        data: { status: EnrolmentStatus.CANCELLED },
      });
      await this.audit(caller, 'training.session_cancelled', 'TrainingSession', id, {});
    }
    return this.getSession(caller, id);
  }

  private async findSession(organizationId: string, id: string) {
    const session = await this.prisma.trainingSession.findFirst({ where: { id, organizationId } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async enrol(caller: Caller, sessionId: string, dto: EnrolDto) {
    await this.requireHr(caller);
    const session = await this.findSession(caller.organizationId, sessionId);
    if (session.status !== TrainingSessionStatus.PLANNED) throw new BadRequestException('You can only add people to a planned session');
    const ids = [...new Set(dto.employeeIds)];
    const found = await this.prisma.employee.count({ where: { id: { in: ids }, organizationId: caller.organizationId } });
    if (found !== ids.length) throw new BadRequestException('Employee not found');
    const existing = await this.prisma.trainingEnrolment.findMany({ where: { sessionId } });
    const active = existing.filter((e) => e.status !== EnrolmentStatus.CANCELLED);
    const toAdd = ids.filter((id) => !active.some((e) => e.employeeId === id));
    const left = seatsLeft(session.capacity, active.length);
    if (left !== null && toAdd.length > left) {
      throw new BadRequestException(`Only ${left} seat${left === 1 ? '' : 's'} left in this session`);
    }
    for (const employeeId of toAdd) {
      const old = existing.find((e) => e.employeeId === employeeId);
      if (old) await this.prisma.trainingEnrolment.update({ where: { id: old.id }, data: { status: EnrolmentStatus.ENROLLED } });
      else {
        await this.prisma.trainingEnrolment.create({
          data: { organizationId: caller.organizationId, courseId: session.courseId, sessionId, employeeId },
        });
      }
    }
    // Their requests for this course are now booked.
    await this.prisma.trainingRequest.updateMany({
      where: {
        organizationId: caller.organizationId,
        courseId: session.courseId,
        employeeId: { in: toAdd },
        status: { in: [TrainingRequestStatus.PENDING, TrainingRequestStatus.APPROVED] },
      },
      data: { status: TrainingRequestStatus.BOOKED },
    });
    if (toAdd.length) await this.audit(caller, 'training.enrolled', 'TrainingSession', sessionId, { count: toAdd.length });
    this.notify.trainingBooked(caller.organizationId, sessionId, toAdd);
    return this.getSession(caller, sessionId);
  }

  async removeEnrolment(caller: Caller, enrolmentId: string) {
    await this.requireHr(caller);
    const e = await this.prisma.trainingEnrolment.findFirst({ where: { id: enrolmentId, organizationId: caller.organizationId } });
    if (!e) throw new NotFoundException('Enrolment not found');
    if (e.status !== EnrolmentStatus.ENROLLED) throw new BadRequestException('Only upcoming places can be removed');
    await this.prisma.trainingEnrolment.delete({ where: { id: enrolmentId } });
    return { ok: true };
  }

  // Who completed (credits hours and a certificate) and who didn't show up.
  // Can be run again to correct mistakes.
  async complete(caller: Caller, sessionId: string, dto: CompleteDto) {
    await this.requireHr(caller);
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, organizationId: caller.organizationId },
      include: { course: true, enrolments: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status === TrainingSessionStatus.CANCELLED) throw new BadRequestException('This session was cancelled');
    if (session.startsAt > new Date()) throw new BadRequestException("This session hasn't started yet");
    const completedAt = startOfDayUtc(session.endsAt);
    const hours = creditedHours(session.course.durationHours, session.startsAt, session.endsAt);
    const expiresAt = certificateExpiry(completedAt, session.course.validityMonths);
    for (const r of dto.results) {
      const e = session.enrolments.find((x) => x.id === r.enrolmentId);
      if (!e || e.status === EnrolmentStatus.CANCELLED) throw new BadRequestException('Unknown person for this session');
      await this.prisma.trainingEnrolment.update({
        where: { id: e.id },
        data:
          r.status === 'COMPLETED'
            ? { status: EnrolmentStatus.COMPLETED, completedAt, hours, certificateExpiresAt: expiresAt, score: r.score ?? null }
            : { status: EnrolmentStatus.NO_SHOW, completedAt: null, hours: null, certificateExpiresAt: null, score: null },
      });
    }
    await this.prisma.trainingSession.update({ where: { id: sessionId }, data: { status: TrainingSessionStatus.DONE } });
    await this.audit(caller, 'training.session_completed', 'TrainingSession', sessionId, {
      course: session.course.title,
      completed: dto.results.filter((r) => r.status === 'COMPLETED').length,
    });
    return this.getSession(caller, sessionId);
  }

  // Training done elsewhere (a course outside, a certificate someone brings).
  async recordExternal(caller: Caller, dto: ExternalRecordDto) {
    await this.requireHr(caller);
    const course = await this.findCourse(caller.organizationId, dto.courseId);
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, organizationId: caller.organizationId } });
    if (!employee) throw new NotFoundException('Employee not found');
    const completedAt = startOfDayUtc(new Date(dto.completedAt));
    if (completedAt > new Date()) throw new BadRequestException("The completion date can't be in the future");
    const record = await this.prisma.trainingEnrolment.create({
      data: {
        organizationId: caller.organizationId,
        courseId: course.id,
        employeeId: employee.id,
        status: EnrolmentStatus.COMPLETED,
        completedAt,
        hours: dto.hours ?? course.durationHours ?? null,
        score: dto.score ?? null,
        certificateExpiresAt: certificateExpiry(completedAt, course.validityMonths),
      },
    });
    await this.audit(caller, 'training.recorded', 'TrainingEnrolment', record.id, { course: course.title, employeeId: employee.id });
    return record;
  }

  // --- Someone's training ---------------------------------------------------

  async mine(caller: Caller) {
    const a = await this.access(caller);
    if (!a.own) return null;
    return this.recordsFor(caller.organizationId, a.own.id, true);
  }

  async forEmployee(caller: Caller, employeeId: string) {
    const a = await this.access(caller);
    const { isSelf } = await this.assertCanSee(caller, a, employeeId);
    return this.recordsFor(caller.organizationId, employeeId, isSelf);
  }

  private async recordsFor(organizationId: string, employeeId: string, isSelf: boolean) {
    const records = await this.prisma.trainingEnrolment.findMany({
      where: { organizationId, employeeId, status: { not: EnrolmentStatus.CANCELLED } },
      include: { course: courseRef, session: sessionRef },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const upcoming = records
      .filter((r) => r.status === EnrolmentStatus.ENROLLED && r.session && r.session.endsAt >= startOfDayUtc(now))
      .sort((x, y) => x.session!.startsAt.getTime() - y.session!.startsAt.getTime());
    const done = records
      .filter((r) => r.status === EnrolmentStatus.COMPLETED || r.status === EnrolmentStatus.NO_SHOW)
      .sort((x, y) => (y.completedAt ?? y.createdAt).getTime() - (x.completedAt ?? x.createdAt).getTime());
    return {
      canGiveFeedback: isSelf,
      hoursThisYear: done
        .filter((r) => r.status === EnrolmentStatus.COMPLETED && r.completedAt && r.completedAt >= yearStart)
        .reduce((s, r) => s + (r.hours ?? 0), 0),
      completedCount: done.filter((r) => r.status === EnrolmentStatus.COMPLETED).length,
      upcoming,
      history: done.map((r) => ({ ...r, certificate: certificateState(r.certificateExpiresAt, now) })),
      certificates: latestCertificates(done, now),
    };
  }

  async feedback(caller: Caller, enrolmentId: string, dto: FeedbackDto) {
    const a = await this.access(caller);
    const e = await this.prisma.trainingEnrolment.findFirst({ where: { id: enrolmentId, organizationId: caller.organizationId } });
    if (!e) throw new NotFoundException('Training not found');
    if (a.own?.id !== e.employeeId) throw new ForbiddenException('Only the person who attended can give feedback');
    if (e.status !== EnrolmentStatus.COMPLETED) throw new BadRequestException('You can give feedback after completing the training');
    return this.prisma.trainingEnrolment.update({
      where: { id: enrolmentId },
      data: { feedbackRating: dto.rating, feedbackComment: dto.comment?.trim() || null },
    });
  }

  async certificate(caller: Caller, enrolmentId: string) {
    const a = await this.access(caller);
    const e = await this.prisma.trainingEnrolment.findFirst({
      where: { id: enrolmentId, organizationId: caller.organizationId },
      include: { course: true, employee: true },
    });
    if (!e) throw new NotFoundException('Training not found');
    await this.assertCanSee(caller, a, e.employeeId);
    if (e.status !== EnrolmentStatus.COMPLETED || !e.completedAt) throw new BadRequestException('Only completed training has a certificate');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: caller.organizationId } });
    const data = await certificatePdf({
      organizationName: org.name,
      employeeName: `${e.employee.firstName} ${e.employee.lastName}`,
      courseTitle: e.course.title,
      completedAt: e.completedAt,
      hours: e.hours,
      expiresAt: e.certificateExpiresAt,
      certificateId: e.id,
    });
    return { fileName: `Certificate - ${e.course.title} - ${e.employee.firstName} ${e.employee.lastName}.pdf`.replace(/[^A-Za-z0-9._\- ]+/g, '_'), data };
  }

  // Certificates that have expired or expire within 60 days — the latest one
  // per person and course, so a renewed certificate clears the warning.
  async expiring(caller: Caller) {
    const a = await this.access(caller);
    if (!a.isHr && !a.own) return [];
    const records = await this.prisma.trainingEnrolment.findMany({
      where: {
        organizationId: caller.organizationId,
        status: EnrolmentStatus.COMPLETED,
        certificateExpiresAt: { not: null },
        employee: { status: { not: 'TERMINATED' }, ...(a.isHr ? {} : { managerId: a.own!.id }) },
      },
      include: { course: courseRef, employee: person },
    });
    const now = new Date();
    return latestCertificates(records, now)
      .filter((r) => r.certificate !== 'VALID')
      .sort((x, y) => x.certificateExpiresAt!.getTime() - y.certificateExpiresAt!.getTime());
  }

  // Training hours and cost per person and department for a year.
  async report(caller: Caller, year: number) {
    await this.requireHr(caller);
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const [employees, departments, records] = await Promise.all([
      this.prisma.employee.findMany({ where: { organizationId: caller.organizationId, status: { not: 'TERMINATED' } }, ...person }),
      this.prisma.department.findMany({ where: { organizationId: caller.organizationId }, select: { id: true, name: true } }),
      this.prisma.trainingEnrolment.findMany({
        where: {
          organizationId: caller.organizationId,
          OR: [
            { status: EnrolmentStatus.COMPLETED, completedAt: { gte: from, lt: to } },
            { status: EnrolmentStatus.NO_SHOW, session: { startsAt: { gte: from, lt: to } } },
          ],
        },
        include: { course: { select: { costPerPerson: true } } },
      }),
    ]);
    const rows = employees.map((e) => {
      const mine = records.filter((r) => r.employeeId === e.id);
      const completed = mine.filter((r) => r.status === EnrolmentStatus.COMPLETED);
      return {
        employee: e,
        hours: completed.reduce((s, r) => s + (r.hours ?? 0), 0),
        courses: completed.length,
        noShows: mine.length - completed.length,
        // A seat that was booked is paid for, whether or not they came.
        cost: mine.reduce((s, r) => s + (r.course.costPerPerson ?? 0), 0),
      };
    });
    const byDepartment = [...departments, { id: null as string | null, name: 'No department' }]
      .map((d) => {
        const inDept = rows.filter((r) => r.employee.departmentId === d.id);
        return {
          department: d.name,
          people: inDept.length,
          hours: inDept.reduce((s, r) => s + r.hours, 0),
          cost: inDept.reduce((s, r) => s + r.cost, 0),
        };
      })
      .filter((d) => d.people > 0);
    return {
      year,
      totals: {
        hours: rows.reduce((s, r) => s + r.hours, 0),
        cost: rows.reduce((s, r) => s + r.cost, 0),
        people: rows.length,
        trained: rows.filter((r) => r.courses > 0).length,
      },
      byDepartment,
      people: rows.sort((x, y) => y.hours - x.hours),
    };
  }

  // --- Requests -------------------------------------------------------------

  async createRequest(caller: Caller, dto: RequestDto) {
    const a = await this.access(caller);
    if (!a.own) throw new BadRequestException('Only employees can ask for training');
    let title = dto.title?.trim();
    if (dto.courseId) {
      const course = await this.findCourse(caller.organizationId, dto.courseId);
      if (!course.isActive) throw new BadRequestException('This course is not in use');
      title = course.title;
      const open = await this.prisma.trainingRequest.count({
        where: { employeeId: a.own.id, courseId: course.id, status: { in: [TrainingRequestStatus.PENDING, TrainingRequestStatus.APPROVED] } },
      });
      if (open) throw new ConflictException('You already asked for this course');
    }
    if (!title) throw new BadRequestException('Choose a course or write what training you need');
    const req = await this.prisma.trainingRequest.create({
      data: { organizationId: caller.organizationId, employeeId: a.own.id, courseId: dto.courseId ?? null, title, reason: dto.reason.trim() },
    });
    await this.audit(caller, 'training.requested', 'TrainingRequest', req.id, { title });
    return req;
  }

  async listRequests(caller: Caller, scope: 'mine' | 'team') {
    const a = await this.access(caller);
    if (scope === 'mine') {
      if (!a.own) return [];
      return this.prisma.trainingRequest.findMany({
        where: { employeeId: a.own.id },
        include: { course: courseRef },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (!a.isHr && !a.own) return [];
    const requests = await this.prisma.trainingRequest.findMany({
      where: {
        organizationId: caller.organizationId,
        ...(a.isHr ? {} : { employee: { managerId: a.own!.id } }),
        OR: [{ status: { in: [TrainingRequestStatus.PENDING, TrainingRequestStatus.APPROVED] } }, { decidedAt: { gte: new Date(Date.now() - 30 * DAY) } }],
      },
      include: { course: courseRef, employee: person },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return requests.map((r) => ({ ...r, canDecide: r.status === TrainingRequestStatus.PENDING && r.employeeId !== a.own?.id }));
  }

  async decide(caller: Caller, id: string, dto: DecideDto) {
    const a = await this.access(caller);
    const req = await this.prisma.trainingRequest.findFirst({
      where: { id, organizationId: caller.organizationId },
      include: { employee: { select: { id: true, managerId: true } } },
    });
    if (!req) throw new NotFoundException('Request not found');
    const isManager = !!a.own && req.employee.managerId === a.own.id;
    if (a.own?.id === req.employeeId) throw new ForbiddenException("You can't decide your own request");
    if (!a.isHr && !isManager) throw new ForbiddenException('Only HR or their manager can decide');
    if (req.status !== TrainingRequestStatus.PENDING) throw new BadRequestException('This request was already decided');
    const updated = await this.prisma.trainingRequest.update({
      where: { id },
      data: {
        status: dto.approve ? TrainingRequestStatus.APPROVED : TrainingRequestStatus.REJECTED,
        decidedByUserId: caller.id,
        decidedAt: new Date(),
        decisionNote: dto.note?.trim() || null,
      },
    });
    await this.audit(caller, dto.approve ? 'training.request_approved' : 'training.request_rejected', 'TrainingRequest', id, { title: req.title });
    return updated;
  }

  private audit(caller: Caller, eventType: string, entityType: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditEvent.create({
      data: { organizationId: caller.organizationId, actorUserId: caller.id, eventType, entityType, entityId, metadata },
    });
  }
}

// Latest certificate per person + course.
function latestCertificates<T extends { employeeId: string; courseId: string; certificateExpiresAt: Date | null; status: EnrolmentStatus }>(
  records: T[],
  now: Date,
) {
  const latest = new Map<string, T>();
  for (const r of records) {
    if (r.status !== EnrolmentStatus.COMPLETED || !r.certificateExpiresAt) continue;
    const key = `${r.employeeId}|${r.courseId}`;
    const cur = latest.get(key);
    if (!cur || cur.certificateExpiresAt! < r.certificateExpiresAt) latest.set(key, r);
  }
  return [...latest.values()].map((r) => ({ ...r, certificate: certificateState(r.certificateExpiresAt, now) }));
}
