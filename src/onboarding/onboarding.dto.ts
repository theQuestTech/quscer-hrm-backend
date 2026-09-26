import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { OnboardingAssignee } from '@prisma/client';

export class TemplateDto {
  @IsString() @MinLength(2) @MaxLength(160) title: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsEnum(OnboardingAssignee) assignee: OnboardingAssignee;
  @IsOptional() @IsInt() @Min(-60) @Max(365) dueDays?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class TaskDto {
  @IsString() employeeId: string;
  @IsString() @MinLength(2) @MaxLength(160) title: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsEnum(OnboardingAssignee) assignee: OnboardingAssignee;
  @IsDateString() dueDate: string;
}

export class DoneDto {
  @IsBoolean() done: boolean;
}
