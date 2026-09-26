import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { KpiMeasure } from '@prisma/client';

export class KpiTemplateDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsEnum(KpiMeasure) measure: KpiMeasure;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsOptional() @IsNumber() defaultTarget?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) defaultWeight?: number;
  @IsOptional() @IsBoolean() higherIsBetter?: boolean;
  @IsOptional() @IsIn(['ATTENDANCE']) auto?: 'ATTENDANCE';
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CycleDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
}

export class LaunchCycleDto {
  // Omit both to include every active employee.
  @IsOptional() @IsArray() @IsString({ each: true }) employeeIds?: string[];
  @IsOptional() @IsString() departmentId?: string;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) kpiTemplateIds: string[];
}

export class ReviewKpiDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEnum(KpiMeasure) measure: KpiMeasure;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsOptional() @IsNumber() target?: number | null;
  @IsInt() @Min(1) @Max(100) weight: number;
  @IsOptional() @IsBoolean() higherIsBetter?: boolean;
  @IsOptional() @IsIn(['ATTENDANCE']) auto?: 'ATTENDANCE' | null;
}

export class SetGoalsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ReviewKpiDto)
  kpis: ReviewKpiDto[];
}

class KpiInputDto {
  @IsString() id: string;
  @IsOptional() @IsNumber() actual?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class RateDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => KpiInputDto) kpis: KpiInputDto[];
  @IsOptional() @IsString() @MaxLength(3000) comment?: string | null;
}
