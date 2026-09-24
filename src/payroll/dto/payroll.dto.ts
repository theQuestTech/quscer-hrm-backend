import { IsArray, IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SalaryComponentType } from '@prisma/client';

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
