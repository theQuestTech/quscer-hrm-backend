import { Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { ApplicationStage, EmploymentType, JobStatus, OfferStatus } from '@prisma/client';

export class JobDto {
  @IsString() @MinLength(2) @MaxLength(120) title: string;
  @IsOptional() @IsString() departmentId?: string | null;
  @IsOptional() @IsString() branchId?: string | null;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType | null;
  @IsOptional() @IsString() @MaxLength(120) location?: string | null;
  @IsString() @MinLength(10) @MaxLength(10000) description: string;
  @IsOptional() @IsString() @MaxLength(10000) requirements?: string | null;
  @IsOptional() @IsString() @MaxLength(80) salaryRange?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) openings?: number;
  @IsOptional() @IsDateString() closesAt?: string | null;
  @IsOptional() @IsEnum(JobStatus) status?: JobStatus;
  @IsOptional() @IsString() hiringManagerEmployeeId?: string | null;
}

// The public form (multipart, so numbers arrive as text). `website` is a
// hidden field people never fill in — bots do.
export class ApplyDto {
  @IsString() @MinLength(1) @MaxLength(60) firstName: string;
  @IsString() @MinLength(1) @MaxLength(60) lastName: string;
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @Matches(/^[+0-9 ()-]{7,20}$/, { message: 'Enter a valid phone number' }) phone: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsString() @MaxLength(120) currentCompany?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000) expectedSalary?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) noticePeriodDays?: number;
  @IsOptional() @IsString() @MaxLength(3000) coverNote?: string;
  @IsOptional() @IsString() website?: string;
}

// HR adding someone by hand (a referral, a walk-in, a CV that came by email).
export class AddCandidateDto extends ApplyDto {
  @IsString() jobId: string;
  @IsOptional() @IsIn(['REFERRAL', 'JOB_BOARD', 'WALK_IN', 'EMAIL', 'OTHER']) source?: string;
}

export class MoveDto {
  @IsEnum(ApplicationStage) stage: ApplicationStage;
  @IsOptional() @IsString() @MaxLength(300) rejectReason?: string;
}

export class NotesDto {
  @IsString() @MaxLength(5000) notes: string;
}

export class InterviewDto {
  @IsDateString() scheduledAt: string;
  @IsOptional() @IsInt() @Min(10) @Max(480) durationMinutes?: number;
  @IsOptional() @IsIn(['IN_PERSON', 'PHONE', 'VIDEO']) mode?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string | null;
  @IsOptional() @IsString() interviewerEmployeeId?: string | null;
}

export class FeedbackDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsIn(['HIRE', 'MAYBE', 'NO_HIRE']) recommendation: string;
  @IsString() @MinLength(2) @MaxLength(5000) feedback: string;
}

export class OfferDto {
  @IsString() @MinLength(2) @MaxLength(120) designation: string;
  @IsInt() @Min(1) @Max(100_000_000) salary: number;
  @IsDateString() joiningDate: string;
  @IsOptional() @IsString() @MaxLength(3000) notes?: string | null;
}

export class OfferStatusDto {
  @IsIn([OfferStatus.SENT, OfferStatus.ACCEPTED, OfferStatus.DECLINED]) status: OfferStatus;
}

export class HireDto {
  @IsString() @MinLength(1) @MaxLength(30) employeeNumber: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsBoolean() startOnboarding?: boolean;
}
