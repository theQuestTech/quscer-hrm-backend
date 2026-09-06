import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { EmployeeStatus } from '@prisma/client';
import { CreateEmployeeDto } from './create-employee.dto';

// NOTE: @nestjs/mapped-types isn't in package.json yet — add it
// (`npm i @nestjs/mapped-types`) before this compiles. Left as the standard
// NestJS pattern rather than hand-duplicating every optional field.
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;
}
