import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ExitReason, SalaryComponentType } from '@prisma/client';

class SalaryComponentInputDto {
  @IsString() @MinLength(1) name: string;
  @IsEnum(SalaryComponentType) type: SalaryComponentType;
  @IsOptional() @IsBoolean() isTaxable?: boolean;
  @IsNumber() amount: number;
}

export class UpsertSalaryStructureDto {
  @IsString() currency: string;
  @IsNumber() basicSalary: number;
  @IsDateString() effectiveFrom: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentInputDto)
  components?: SalaryComponentInputDto[];
}

export class CreatePayrollRunDto {
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
  @IsDateString() payDate: string;
}

export class CreateLoanDto {
  @IsNumber() principal: number;
  @IsNumber() installmentAmount: number;
  @IsDateString() startDate: string;
}

class SettlementAdjustmentDto {
  @IsString() @MinLength(1) label: string;
  @IsNumber() @Min(0) amount: number;
  @IsIn(['earning', 'deduction']) type: 'earning' | 'deduction';
}

// WBS 4.14 — creating or recalculating a draft final settlement.
export class UpsertFinalSettlementDto {
  @IsDateString() lastWorkingDay: string;
  @IsEnum(ExitReason) reason: ExitReason;
  @IsOptional() @IsBoolean() includeGratuity?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(365) noticeDaysInLieu?: number;
  @IsOptional() @IsInt() @Min(0) @Max(365) noticeDaysShort?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SettlementAdjustmentDto)
  adjustments?: SettlementAdjustmentDto[];
  @IsOptional() @IsString() notes?: string;
}
