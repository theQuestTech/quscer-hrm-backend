import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import { CompanyDeductionMethod } from '@prisma/client';
import { IsCountryCode, IsRegionCode } from '../../common/geo';

class SlabDto {
  // Yearly; null on the last band = everything above.
  @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) upTo: number | null;
  @IsNumber() @Min(0) @Max(100) ratePercent: number;
}

// Cross-field rules (which numbers each method needs) are checked in the service.
export class CreateCompanyDeductionDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsCountryCode() countryCode?: string | null; // null = every country
  @IsOptional() @IsRegionCode() regionCode?: string | null;
  @IsEnum(CompanyDeductionMethod) method: CompanyDeductionMethod;
  @IsOptional() @IsNumber() @Min(0) @Max(100) employeePercent?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) employerPercent?: number | null;
  @IsOptional() @IsNumber() @Min(0) employeeAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0) employerAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0.01) wageCap?: number | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SlabDto)
  slabs?: SlabDto[] | null;
  @IsOptional() @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code such as AED' }) currency?: string | null;
  @IsOptional() @IsBoolean() appliesToAll?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) employeeIds?: string[];
  @IsOptional() @IsBoolean() reducesTaxablePay?: boolean;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'effectiveFrom must be a month such as 2026-01' }) effectiveFrom: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'effectiveTo must be a month such as 2026-12' }) effectiveTo?: string | null;
  @IsOptional() @IsString() @MaxLength(200) sourceRef?: string | null;
}

export class UpdateCompanyDeductionDto extends PartialType(CreateCompanyDeductionDto) {}
