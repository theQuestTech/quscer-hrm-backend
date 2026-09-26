// Recruitment.
//   HR (edits employees or company settings) posts jobs, manages candidates,
//   schedules interviews, makes offers and hires. A job's hiring manager can
//   see that job's candidates; an interviewer can see the candidate they are
//   interviewing and give feedback. Neither sees HR's private notes or the
//   offer. People apply on the company's public careers page.

import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ApplicationStage, InterviewStatus, JobStatus, OfferStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { EmployeesService } from '../employees/employees.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { Caller, callerAccess } from '../common/caller-access';
import {
  AddCandidateDto, ApplyDto, FeedbackDto, HireDto, InterviewDto, JobDto, MoveDto, OfferDto,
} from './recruitment.dto';
import { MAX_CV_BYTES, acceptingApplications, canMoveTo, cvFileName, slugify, sniffCvType } from './recruitment-rules';
import { OfferLetterData, offerLetterPdf } from './offer-letter';
import { NotifyService } from '../notifications/notify.service';

const STAGES = Object.values(ApplicationStage);
const person = { select: { id: true, firstName: true, lastName: true, designation: true, photoUpdatedAt: true } } as const;
const listFields = {
  id: true, jobId: true, firstName: true, lastName: true, email: true, phone: true, city: true, stage: true,
  source: true, createdAt: true, updatedAt: true, cvFileName: true, hiredEmployeeId: true,
} as const;

type Access = Awaited<ReturnType<typeof callerAccess>>;

@Injectable()
export class RecruitmentService {
  constructor(
    private prisma: PrismaService,
    private rbac: RbacService,
    private employees: EmployeesService,
    private onboarding: OnboardingService,
    private notify: NotifyService,
  ) {}

  // --- Access ---------------------------------------------------------------

  private async access(caller: Caller) {
    const a = await callerAccess(this.prisma, this.rbac, caller);
    await this.assertModuleOn(caller.organizationId);
    return a;
  }

  private async requireHr(caller: Caller) {
    const a = await this.access(caller);
    if (!a.isHr) throw new ForbiddenException('Only HR can do this');
    return a;
  }

  private async moduleOn(organizationId: string) {
    const s = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } });
    return (s?.enabledModules ?? ['performance', 'training', 'recruitment']).includes('recruitment');
  }

  private async assertModuleOn(organizationId: string) {
    if (!(await this.moduleOn(organizationId))) {
      throw new ForbiddenException('Recruitment is turned off for this company. HR can turn it on in Settings.');
    }
  }

  // HR, the job's hiring manager, or one of the candidate's interviewers.
  private async loadApplication(caller: Caller, id: string) {
    const a = await this.access(caller);
    const app = await this.prisma.jobApplication.findFirst({
      where: { id, organizationId: caller.organizationId },
      include: { job: true, interviews: { orderBy: { scheduledAt: 'asc' } } },
    });
    if (!app) throw new NotFoundException('Candidate not found');
    const isHiringManager = !!a.own && app.job.hiringManagerEmployeeId === a.own.id;
    const isInterviewer = !!a.own && app.interviews.some((i) => i.interviewerEmployeeId === a.own!.id);
    if (!a.isHr && !isHiringManager && !isInterviewer) throw new ForbiddenException("You can't see this candidate");
    return { a, app };
  }

  // --- Careers page address -------------------------------------------------

  // Makes sure the company has a careers address, picking one from its name
  // the first time.
  async careersLink(caller: Caller) {
    await this.requireHr(caller);
    return { slug: await this.ensureSlug(caller.organizationId) };
  }

  private async ensureSlug(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.careersSlug) return org.careersSlug;
    const base = slugify(org.name);
    for (let i = 0; i < 20; i++) {
      const slug = i === 0 ? base : `${base.slice(0, 36)}-${i + 1}`;
      try {
        await this.prisma.organization.update({ where: { id: organizationId }, data: { careersSlug: slug } });
        return slug;
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
    }
    throw new ConflictException('Could not pick a careers page address — set one in Settings');
  }

  // --- Jobs -----------------------------------------------------------------

  async listJobs(caller: Caller) {
    const a = await this.access(caller);
    if (!a.isHr && !a.own) return [];
    const jobs = await this.prisma.jobOpening.findMany({
      where: { organizationId: caller.organizationId, ...(a.isHr ? {} : { hiringManagerEmployeeId: a.own!.id }) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    const counts = await this.prisma.jobApplication.groupBy({
      by: ['jobId', 'stage'],
      where: { jobId: { in: jobs.map((j) => j.id) } },
      _count: { _all: true },
    });
    const names = await this.names(caller.organizationId, jobs.map((j) => j.departmentId), jobs.map((j) => j.hiringManagerEmployeeId));
    return jobs.map((j) => {
      const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ApplicationStage, number>;
      for (const c of counts) if (c.jobId === j.id) byStage[c.stage] = c._count._all;
      return {
        ...j,
        department: j.departmentId ? names.departments.get(j.departmentId) ?? null : null,
        hiringManager: j.hiringManagerEmployeeId ? names.people.get(j.hiringManagerEmployeeId) ?? null : null,
        byStage,
        total: Object.values(byStage).reduce((s, n) => s + n, 0),
        hired: byStage.HIRED,
      };
    });
  }

  async getJob(caller: Caller, id: string) {
    const a = await this.access(caller);
    const job = await this.prisma.jobOpening.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!job) throw new NotFoundException('Job not found');
    if (!a.isHr && !(a.own && job.hiringManagerEmployeeId === a.own.id)) throw new ForbiddenException("You can't see this job");
    const applications = await this.prisma.jobApplication.findMany({
      where: { jobId: id },
      select: { ...listFields, interviews: { select: { rating: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const names = await this.names(caller.organizationId, [job.departmentId], [job.hiringManagerEmployeeId]);
    return {
      ...job,
      department: job.departmentId ? names.departments.get(job.departmentId) ?? null : null,
      hiringManager: job.hiringManagerEmployeeId ? names.people.get(job.hiringManagerEmployeeId) ?? null : null,
      canManage: a.isHr,
      careersSlug: a.isHr ? await this.ensureSlug(caller.organizationId) : null,
      applications: applications.map(({ interviews, ...x }) => ({ ...x, averageRating: averageRating(interviews) })),
    };
  }

  async createJob(caller: Caller, dto: JobDto) {
    await this.requireHr(caller);
    await this.assertJobRefs(caller.organizationId, dto);
    const job = await this.prisma.jobOpening.create({ data: { organizationId: caller.organizationId, ...this.jobData(dto), title: dto.title, description: dto.description } });
    await this.audit(caller, 'recruitment.job_created', 'JobOpening', job.id, { title: job.title });
    return job;
  }

  async updateJob(caller: Caller, id: string, dto: Partial<JobDto>) {
    await this.requireHr(caller);
    const job = await this.prisma.jobOpening.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.assertJobRefs(caller.organizationId, dto);
    const updated = await this.prisma.jobOpening.update({ where: { id }, data: this.jobData(dto) });
    if (dto.status && dto.status !== job.status) {
      await this.audit(caller, `recruitment.job_${dto.status.toLowerCase()}`, 'JobOpening', id, { title: job.title });
    }
    return updated;
  }

  async removeJob(caller: Caller, id: string) {
    await this.requireHr(caller);
    const job = await this.prisma.jobOpening.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!job) throw new NotFoundException('Job not found');
    if (await this.prisma.jobApplication.count({ where: { jobId: id } })) {
      throw new ConflictException('This job has candidates — close it instead of deleting it');
    }
    await this.prisma.jobOpening.delete({ where: { id } });
    return { ok: true };
  }

  private jobData<T extends Partial<JobDto>>(dto: T) {
    const { closesAt, ...rest } = dto;
    return { ...rest, ...(closesAt !== undefined && { closesAt: closesAt ? new Date(closesAt) : null }) };
  }

  private async assertJobRefs(organizationId: string, dto: Partial<JobDto>) {
    if (dto.departmentId && !(await this.prisma.department.count({ where: { id: dto.departmentId, organizationId } }))) {
      throw new BadRequestException('Department not found');
    }
    if (dto.branchId && !(await this.prisma.branch.count({ where: { id: dto.branchId, organizationId } }))) {
      throw new BadRequestException('Branch not found');
    }
    if (dto.hiringManagerEmployeeId && !(await this.prisma.employee.count({ where: { id: dto.hiringManagerEmployeeId, organizationId } }))) {
      throw new BadRequestException('Hiring manager not found');
    }
  }

  // --- Candidates -----------------------------------------------------------

  async listApplications(caller: Caller, q: { stage?: string; jobId?: string; search?: string }) {
    await this.requireHr(caller);
    const where: Prisma.JobApplicationWhereInput = { organizationId: caller.organizationId };
    if (q.stage && STAGES.includes(q.stage as ApplicationStage)) where.stage = q.stage as ApplicationStage;
    if (q.jobId) where.jobId = q.jobId;
    if (q.search?.trim()) {
      const s = q.search.trim();
      where.OR = [
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
      ];
    }
    const apps = await this.prisma.jobApplication.findMany({
      where,
      select: { ...listFields, job: { select: { id: true, title: true } }, interviews: { select: { rating: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return apps.map(({ interviews, ...x }) => ({ ...x, averageRating: averageRating(interviews) }));
  }

  async getApplication(caller: Caller, id: string) {
    const { a, app } = await this.loadApplication(caller, id);
    const interviewerIds = app.interviews.map((i) => i.interviewerEmployeeId);
    const names = await this.names(caller.organizationId, [], interviewerIds);
    const timeline = a.isHr
      ? await this.prisma.auditEvent.findMany({
          where: { organizationId: caller.organizationId, entityType: 'JobApplication', entityId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, eventType: true, createdAt: true, metadata: true, actorUserId: true },
        })
      : [];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: timeline.map((t) => t.actorUserId).filter((x): x is string => !!x) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const { job, interviews, notes, offerDesignation, offerSalary, offerJoiningDate, offerNotes, offerStatus, offerSentAt, ...rest } = app;
    return {
      ...rest,
      job: { id: job.id, title: job.title, departmentId: job.departmentId, branchId: job.branchId, employmentType: job.employmentType },
      notes: a.isHr ? notes : null,
      offer: a.isHr && offerStatus
        ? { designation: offerDesignation, salary: offerSalary, joiningDate: offerJoiningDate, notes: offerNotes, status: offerStatus, sentAt: offerSentAt }
        : null,
      averageRating: averageRating(interviews),
      interviews: interviews.map((i) => ({
        ...i,
        interviewer: i.interviewerEmployeeId ? names.people.get(i.interviewerEmployeeId) ?? null : null,
        canGiveFeedback: i.status !== InterviewStatus.CANCELLED && (a.isHr || (!!a.own && i.interviewerEmployeeId === a.own.id)),
      })),
      timeline: timeline.map((t) => ({ ...t, actor: actors.find((u) => u.id === t.actorUserId) ?? null })),
      can: { manage: a.isHr && app.stage !== ApplicationStage.HIRED, hire: a.isHr && app.stage === ApplicationStage.OFFER },
    };
  }

  async addCandidate(caller: Caller, dto: AddCandidateDto, file: Express.Multer.File | undefined) {
    await this.requireHr(caller);
    const job = await this.prisma.jobOpening.findFirst({ where: { id: dto.jobId, organizationId: caller.organizationId } });
    if (!job) throw new NotFoundException('Job not found');
    const app = await this.createApplication(caller.organizationId, job.id, dto, file, dto.source ?? 'OTHER', false);
    await this.audit(caller, 'recruitment.candidate_added', 'JobApplication', app.id, { jobTitle: job.title, name: `${app.firstName} ${app.lastName}` });
    return app;
  }

  private async createApplication(
    organizationId: string, jobId: string, dto: ApplyDto, file: Express.Multer.File | undefined, source: string, cvRequired: boolean,
  ) {
    let cv: { mimeType: string; ext: string } | null = null;
    if (file) {
      if (file.size > MAX_CV_BYTES) throw new BadRequestException('Your CV can be at most 5 MB');
      cv = sniffCvType(file.buffer);
      if (!cv) throw new BadRequestException('Your CV must be a PDF or Word file');
    } else if (cvRequired) {
      throw new BadRequestException('Please attach your CV');
    }
    const email = dto.email.trim().toLowerCase();
    try {
      return await this.prisma.jobApplication.create({
        data: {
          organizationId,
          jobId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          email,
          phone: dto.phone.trim(),
          city: dto.city?.trim() || null,
          currentCompany: dto.currentCompany?.trim() || null,
          expectedSalary: dto.expectedSalary ?? null,
          noticePeriodDays: dto.noticePeriodDays ?? null,
          coverNote: dto.coverNote?.trim() || null,
          source,
          ...(cv && file && {
            cvFileName: cvFileName(dto.firstName, dto.lastName, cv.ext),
            cvMimeType: cv.mimeType,
            cvSizeBytes: file.size,
            cv: { create: { data: file.buffer } },
          }),
        },
        select: listFields,
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Someone with this email has already applied for this job');
      throw e;
    }
  }

  async downloadCv(caller: Caller, id: string) {
    const { app } = await this.loadApplication(caller, id);
    const file = await this.prisma.jobApplicationFile.findUnique({ where: { applicationId: id } });
    if (!file) throw new NotFoundException('No CV was attached');
    return { fileName: app.cvFileName ?? 'CV', mimeType: app.cvMimeType ?? 'application/octet-stream', data: file.data };
  }

  async move(caller: Caller, id: string, dto: MoveDto) {
    const { app } = await this.loadApplication(caller, id);
    await this.requireHr(caller);
    if (!canMoveTo(app.stage, dto.stage)) {
      throw new BadRequestException(dto.stage === ApplicationStage.HIRED ? 'Use Hire to hire someone' : "This candidate can't be moved");
    }
    await this.prisma.jobApplication.update({
      where: { id },
      data: { stage: dto.stage, rejectReason: dto.stage === ApplicationStage.REJECTED ? dto.rejectReason?.trim() || null : null },
    });
    await this.audit(caller, 'recruitment.stage_changed', 'JobApplication', id, {
      from: app.stage, to: dto.stage, name: `${app.firstName} ${app.lastName}`, ...(dto.rejectReason && { reason: dto.rejectReason }),
    });
    return this.getApplication(caller, id);
  }

  async setNotes(caller: Caller, id: string, notes: string) {
    await this.requireHr(caller);
    await this.loadApplication(caller, id);
    await this.prisma.jobApplication.update({ where: { id }, data: { notes: notes.trim() || null } });
    return { ok: true };
  }

  // --- Interviews -----------------------------------------------------------

  async scheduleInterview(caller: Caller, id: string, dto: InterviewDto) {
    await this.requireHr(caller);
    const { app } = await this.loadApplication(caller, id);
    if (app.stage === ApplicationStage.HIRED || app.stage === ApplicationStage.REJECTED) {
      throw new BadRequestException('This candidate is no longer in the running');
    }
    await this.assertInterviewer(caller.organizationId, dto.interviewerEmployeeId);
    const interview = await this.prisma.interview.create({
      data: {
        applicationId: id,
        scheduledAt: new Date(dto.scheduledAt),
        durationMinutes: dto.durationMinutes ?? 30,
        mode: dto.mode ?? 'IN_PERSON',
        location: dto.location?.trim() || null,
        interviewerEmployeeId: dto.interviewerEmployeeId || null,
      },
    });
    if (app.stage === ApplicationStage.APPLIED || app.stage === ApplicationStage.SCREENING) {
      await this.prisma.jobApplication.update({ where: { id }, data: { stage: ApplicationStage.INTERVIEW } });
    }
    await this.audit(caller, 'recruitment.interview_scheduled', 'JobApplication', id, {
      name: `${app.firstName} ${app.lastName}`, at: interview.scheduledAt.toISOString(),
    });
    return this.getApplication(caller, id);
  }

  async updateInterview(caller: Caller, interviewId: string, dto: Partial<InterviewDto> & { status?: InterviewStatus }) {
    await this.requireHr(caller);
    const interview = await this.findInterview(caller.organizationId, interviewId);
    await this.assertInterviewer(caller.organizationId, dto.interviewerEmployeeId);
    await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        ...(dto.scheduledAt && { scheduledAt: new Date(dto.scheduledAt) }),
        ...(dto.durationMinutes && { durationMinutes: dto.durationMinutes }),
        ...(dto.mode && { mode: dto.mode }),
        ...(dto.location !== undefined && { location: dto.location?.trim() || null }),
        ...(dto.interviewerEmployeeId !== undefined && { interviewerEmployeeId: dto.interviewerEmployeeId || null }),
        ...(dto.status === InterviewStatus.CANCELLED && { status: InterviewStatus.CANCELLED }),
      },
    });
    return this.getApplication(caller, interview.applicationId);
  }

  async giveFeedback(caller: Caller, interviewId: string, dto: FeedbackDto) {
    const interview = await this.findInterview(caller.organizationId, interviewId);
    const { a } = await this.loadApplication(caller, interview.applicationId);
    if (!a.isHr && !(a.own && interview.interviewerEmployeeId === a.own.id)) {
      throw new ForbiddenException('Only the interviewer or HR can give feedback');
    }
    if (interview.status === InterviewStatus.CANCELLED) throw new BadRequestException('This interview was cancelled');
    await this.prisma.interview.update({
      where: { id: interviewId },
      data: { status: InterviewStatus.DONE, rating: dto.rating, recommendation: dto.recommendation, feedback: dto.feedback.trim() },
    });
    await this.audit(caller, 'recruitment.feedback_given', 'JobApplication', interview.applicationId, {
      rating: dto.rating, recommendation: dto.recommendation,
    });
    return this.getApplication(caller, interview.applicationId);
  }

  // Interviews I am doing (upcoming first), and for HR all upcoming ones.
  async interviews(caller: Caller, scope: 'mine' | 'all') {
    const a = await this.access(caller);
    if (scope === 'all' && !a.isHr) throw new ForbiddenException('Only HR can see all interviews');
    if (scope === 'mine' && !a.own) return [];
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const list = await this.prisma.interview.findMany({
      where: {
        application: { organizationId: caller.organizationId },
        status: { not: InterviewStatus.CANCELLED },
        ...(scope === 'mine' ? { interviewerEmployeeId: a.own!.id } : { status: InterviewStatus.SCHEDULED }),
        scheduledAt: { gte: since },
      },
      include: { application: { select: { id: true, firstName: true, lastName: true, job: { select: { id: true, title: true } } } } },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    });
    const names = await this.names(caller.organizationId, [], list.map((i) => i.interviewerEmployeeId));
    return list.map((i) => ({ ...i, interviewer: i.interviewerEmployeeId ? names.people.get(i.interviewerEmployeeId) ?? null : null }));
  }

  private async findInterview(organizationId: string, id: string) {
    const interview = await this.prisma.interview.findFirst({ where: { id, application: { organizationId } } });
    if (!interview) throw new NotFoundException('Interview not found');
    return interview;
  }

  private async assertInterviewer(organizationId: string, employeeId?: string | null) {
    if (employeeId && !(await this.prisma.employee.count({ where: { id: employeeId, organizationId } }))) {
      throw new BadRequestException('Interviewer not found');
    }
  }

  // --- Offer ----------------------------------------------------------------

  async setOffer(caller: Caller, id: string, dto: OfferDto) {
    await this.requireHr(caller);
    const { app } = await this.loadApplication(caller, id);
    if (app.stage === ApplicationStage.HIRED || app.stage === ApplicationStage.REJECTED) {
      throw new BadRequestException('This candidate is no longer in the running');
    }
    await this.prisma.jobApplication.update({
      where: { id },
      data: {
        stage: ApplicationStage.OFFER,
        offerDesignation: dto.designation.trim(),
        offerSalary: dto.salary,
        offerJoiningDate: new Date(dto.joiningDate),
        offerNotes: dto.notes?.trim() || null,
        // Changing a declined offer makes it a fresh one.
        offerStatus: app.offerStatus && app.offerStatus !== OfferStatus.DECLINED ? app.offerStatus : OfferStatus.DRAFT,
      },
    });
    await this.audit(caller, 'recruitment.offer_saved', 'JobApplication', id, { name: `${app.firstName} ${app.lastName}`, salary: dto.salary });
    return this.getApplication(caller, id);
  }

  async setOfferStatus(caller: Caller, id: string, status: OfferStatus) {
    await this.requireHr(caller);
    const { app } = await this.loadApplication(caller, id);
    if (app.stage !== ApplicationStage.OFFER || !app.offerStatus) throw new BadRequestException('Make an offer first');
    await this.prisma.jobApplication.update({
      where: { id },
      data: { offerStatus: status, ...(status === OfferStatus.SENT && { offerSentAt: new Date() }) },
    });
    await this.audit(caller, `recruitment.offer_${status.toLowerCase()}`, 'JobApplication', id, { name: `${app.firstName} ${app.lastName}` });
    return this.getApplication(caller, id);
  }

  async offerLetter(caller: Caller, id: string) {
    await this.requireHr(caller);
    const { app } = await this.loadApplication(caller, id);
    if (!app.offerStatus || !app.offerSalary || !app.offerJoiningDate || !app.offerDesignation) throw new BadRequestException('Make an offer first');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: caller.organizationId }, include: { localeSettings: true } });
    const branch = app.job.branchId ? await this.prisma.branch.findUnique({ where: { id: app.job.branchId } }) : null;
    const department = app.job.departmentId ? await this.prisma.department.findUnique({ where: { id: app.job.departmentId } }) : null;
    const data: OfferLetterData = {
      organizationName: org.name,
      candidateName: `${app.firstName} ${app.lastName}`,
      city: app.city,
      designation: app.offerDesignation,
      department: department?.name ?? null,
      location: branch?.name ?? app.job.location ?? null,
      employmentType: app.job.employmentType,
      salary: app.offerSalary,
      currency: org.localeSettings?.defaultCurrency ?? 'PKR',
      joiningDate: app.offerJoiningDate,
      notes: app.offerNotes,
      issuedOn: new Date(),
    };
    const pdf = await offerLetterPdf(data);
    return { fileName: `Offer letter - ${app.firstName} ${app.lastName}.pdf`.replace(/[^A-Za-z0-9._\- ]+/g, '_'), data: pdf };
  }

  // --- Hire -----------------------------------------------------------------

  // Creates the employee from the offer, sets their basic salary, files the
  // CV under their documents and (optionally) starts their joining checklist.
  async hire(caller: Caller, id: string, dto: HireDto) {
    await this.requireHr(caller);
    const { app } = await this.loadApplication(caller, id);
    if (app.stage !== ApplicationStage.OFFER || !app.offerDesignation || !app.offerJoiningDate || !app.offerSalary) {
      throw new BadRequestException('Make an offer before hiring');
    }
    if (app.offerStatus === OfferStatus.DECLINED) throw new BadRequestException('This offer was declined');
    const org = await this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId: caller.organizationId } });
    const employee = await this.employees.create(caller.organizationId, caller.id, {
      employeeNumber: dto.employeeNumber.trim(),
      firstName: app.firstName,
      lastName: app.lastName,
      email: app.email,
      phone: app.phone,
      city: app.city ?? undefined,
      designation: app.offerDesignation,
      employmentType: dto.employmentType ?? app.job.employmentType ?? undefined,
      dateOfJoining: app.offerJoiningDate.toISOString(),
      departmentId: dto.departmentId ?? app.job.departmentId ?? undefined,
      branchId: dto.branchId ?? app.job.branchId ?? undefined,
      managerId: dto.managerId || undefined,
    });
    await this.prisma.employeeSalaryStructure.create({
      data: {
        employeeId: employee.id,
        currency: org?.defaultCurrency ?? 'PKR',
        basicSalary: app.offerSalary,
        effectiveFrom: app.offerJoiningDate,
      },
    });
    const cv = await this.prisma.jobApplicationFile.findUnique({ where: { applicationId: id } });
    if (cv && app.cvMimeType) {
      await this.prisma.employeeDocument.create({
        data: {
          employeeId: employee.id,
          category: 'CV',
          fileName: app.cvFileName,
          mimeType: app.cvMimeType,
          sizeBytes: app.cvSizeBytes,
          file: { create: { data: cv.data } },
        },
      });
    }
    await this.prisma.jobApplication.update({
      where: { id },
      data: { stage: ApplicationStage.HIRED, hiredEmployeeId: employee.id, offerStatus: OfferStatus.ACCEPTED },
    });
    await this.audit(caller, 'recruitment.hired', 'JobApplication', id, {
      name: `${app.firstName} ${app.lastName}`, employeeId: employee.id, jobTitle: app.job.title,
    });
    let onboarding: { started: boolean; reason?: string } = { started: false };
    if (dto.startOnboarding) {
      try {
        await this.onboarding.startFor(caller.organizationId, caller.id, employee.id);
        onboarding = { started: true };
      } catch (e) {
        onboarding = { started: false, reason: e instanceof Error ? e.message : 'Could not start onboarding' };
      }
    }
    return { employeeId: employee.id, onboarding };
  }

  // --- Public careers page ----------------------------------------------------

  private async publicOrg(slug: string) {
    const org = await this.prisma.organization.findUnique({ where: { careersSlug: slug.toLowerCase() } });
    if (!org || !(await this.moduleOn(org.id))) throw new NotFoundException('Careers page not found');
    return org;
  }

  private publicJob<T extends { id: string; title: string; location: string | null; employmentType: unknown; description: string; requirements: string | null; salaryRange: string | null; closesAt: Date | null; createdAt: Date; departmentId: string | null; branchId: string | null }>(
    j: T, names: { departments: Map<string, string>; branches: Map<string, string> },
  ) {
    return {
      id: j.id,
      title: j.title,
      department: j.departmentId ? names.departments.get(j.departmentId) ?? null : null,
      location: j.location ?? (j.branchId ? names.branches.get(j.branchId) ?? null : null),
      employmentType: j.employmentType,
      description: j.description,
      requirements: j.requirements,
      salaryRange: j.salaryRange,
      closesAt: j.closesAt,
      postedAt: j.createdAt,
    };
  }

  private async publicNames(organizationId: string) {
    const [departments, branches] = await Promise.all([
      this.prisma.department.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      this.prisma.branch.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);
    return { departments: new Map(departments.map((d) => [d.id, d.name])), branches: new Map(branches.map((b) => [b.id, b.name])) };
  }

  async careersPage(slug: string) {
    const org = await this.publicOrg(slug);
    const jobs = await this.prisma.jobOpening.findMany({
      where: { organizationId: org.id, status: JobStatus.OPEN },
      orderBy: { createdAt: 'desc' },
    });
    const names = await this.publicNames(org.id);
    return {
      company: org.name,
      jobs: jobs.filter((j) => acceptingApplications(j)).map((j) => this.publicJob(j, names)),
    };
  }

  async publicJobDetail(slug: string, jobId: string) {
    const org = await this.publicOrg(slug);
    const job = await this.prisma.jobOpening.findFirst({ where: { id: jobId, organizationId: org.id, status: JobStatus.OPEN } });
    if (!job || !acceptingApplications(job)) throw new NotFoundException('This job is no longer open');
    return { company: org.name, job: this.publicJob(job, await this.publicNames(org.id)) };
  }

  async apply(slug: string, jobId: string, dto: ApplyDto, file: Express.Multer.File | undefined) {
    const org = await this.publicOrg(slug);
    const job = await this.prisma.jobOpening.findFirst({ where: { id: jobId, organizationId: org.id, status: JobStatus.OPEN } });
    if (!job || !acceptingApplications(job)) throw new NotFoundException('This job is no longer open');
    // Bots fill in the hidden field; pretend it worked so they move on.
    if (dto.website) return { ok: true };
    const app = await this.createApplication(org.id, job.id, dto, file, 'CAREERS_PAGE', true);
    await this.prisma.auditEvent.create({
      data: {
        organizationId: org.id,
        eventType: 'recruitment.applied',
        entityType: 'JobApplication',
        entityId: app.id,
        metadata: { jobTitle: job.title, name: `${app.firstName} ${app.lastName}` },
      },
    });
    this.notify.candidateApplied(org.id, app.id);
    return { ok: true };
  }

  // --- Helpers ----------------------------------------------------------------

  private async names(organizationId: string, departmentIds: (string | null)[], employeeIds: (string | null)[]) {
    const dIds = [...new Set(departmentIds.filter((x): x is string => !!x))];
    const eIds = [...new Set(employeeIds.filter((x): x is string => !!x))];
    const [departments, people] = await Promise.all([
      dIds.length ? this.prisma.department.findMany({ where: { organizationId, id: { in: dIds } }, select: { id: true, name: true } }) : [],
      eIds.length ? this.prisma.employee.findMany({ where: { organizationId, id: { in: eIds } }, ...person }) : [],
    ]);
    return {
      departments: new Map(departments.map((d) => [d.id, d.name])),
      people: new Map(people.map((p) => [p.id, p])),
    };
  }

  private audit(caller: Caller, eventType: string, entityType: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditEvent.create({
      data: { organizationId: caller.organizationId, actorUserId: caller.id, eventType, entityType, entityId, metadata },
    });
  }
}

function averageRating(interviews: { rating: number | null; status: InterviewStatus }[]): number | null {
  const rated = interviews.filter((i) => i.status === InterviewStatus.DONE && i.rating !== null);
  if (!rated.length) return null;
  return Math.round((rated.reduce((s, i) => s + i.rating!, 0) / rated.length) * 10) / 10;
}
