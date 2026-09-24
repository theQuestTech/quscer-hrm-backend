import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class UpdateOrganizationSettingsDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{2}$/) defaultCountryCode?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) defaultCurrency?: string;
  @IsOptional() @IsString() defaultTimezone?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekendDays?: number[];
}

export class CreateBranchDto {
  @IsString() @MinLength(1) name: string;
  @IsString() @Matches(/^[A-Z]{2}$/) countryCode: string;
  @IsOptional() @IsString() regionCode?: string;
  @IsString() timezone: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateBranchDto extends PartialType(CreateBranchDto) {}

export class CreateDepartmentDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() parentId?: string;
}
export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

export class CreateCostCentreDto {
  @IsString() @MinLength(1) code: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() branchId?: string;
}
export class UpdateCostCentreDto extends PartialType(CreateCostCentreDto) {}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateShiftDto {
  @IsString() @MinLength(1) name: string;
  @IsString() @Matches(HH_MM, { message: 'startTime must be HH:mm' }) startTime: string;
  @IsString() @Matches(HH_MM, { message: 'endTime must be HH:mm' }) endTime: string;
}
export class UpdateShiftDto extends PartialType(CreateShiftDto) {}

export class CreateHolidayDto {
  @IsString() @MinLength(1) name: string;
  @IsDateString() date: string;
  @IsOptional() @IsString() branchId?: string;
}

export class QueryHolidaysDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
