import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { EmployeeStatus, EmploymentType } from '@prisma/client';

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  employeeNumber: string;

  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(1)
  designation: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsDateString()
  dateOfJoining: string;

  @IsOptional()
  @IsDateString()
  probationEndDate?: string;

  @IsOptional()
  @IsDateString()
  contractEndDate?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  regionCode?: string;
}
