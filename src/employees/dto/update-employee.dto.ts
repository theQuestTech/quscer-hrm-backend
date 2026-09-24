import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { EmployeeStatus } from '@prisma/client';
import { CreateEmployeeDto } from './create-employee.dto';

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {
  @IsOptional()
  @IsEnum(EmployeeStatus)
  status?: EmployeeStatus;

  // Set when probation ends and the employee is confirmed (WBS 2.4).
  @IsOptional()
  @IsDateString()
  confirmedAt?: string;
}
