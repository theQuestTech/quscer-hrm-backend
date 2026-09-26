import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString,
  Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { TrainingDelivery, TrainingSessionStatus } from '@prisma/client';

export class CourseDto {
  @IsString() @MinLength(2) @MaxLength(160) title: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(60) category?: string | null;
  @IsOptional() @IsString() @MaxLength(120) provider?: string | null;
  @IsOptional() @IsEnum(TrainingDelivery) delivery?: TrainingDelivery;
  @IsOptional() @IsNumber() @Min(0.5) @Max(1000) durationHours?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) costPerPerson?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(120) validityMonths?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SessionDto {
  @IsString() courseId: string;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string | null;
  @IsOptional() @IsString() @MaxLength(120) trainer?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(1000) capacity?: number | null;
}

export class UpdateSessionDto {
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string | null;
  @IsOptional() @IsString() @MaxLength(120) trainer?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(1000) capacity?: number | null;
  @IsOptional() @IsIn([TrainingSessionStatus.CANCELLED]) status?: TrainingSessionStatus;
}

export class EnrolDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true }) employeeIds: string[];
}

class ResultDto {
  @IsString() enrolmentId: string;
  @IsIn(['COMPLETED', 'NO_SHOW']) status: 'COMPLETED' | 'NO_SHOW';
  @IsOptional() @IsInt() @Min(0) @Max(100) score?: number | null;
}

export class CompleteDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ResultDto) results: ResultDto[];
}

export class ExternalRecordDto {
  @IsString() employeeId: string;
  @IsString() courseId: string;
  @IsDateString() completedAt: string;
  @IsOptional() @IsNumber() @Min(0.5) @Max(1000) hours?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) score?: number;
}

export class FeedbackDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string | null;
}

export class RequestDto {
  @IsOptional() @IsString() courseId?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) title?: string;
  @IsString() @MinLength(5) @MaxLength(2000) reason: string;
}

export class DecideDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}
