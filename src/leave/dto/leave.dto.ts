import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateLeaveTypeDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsInt() @Min(0) defaultAnnualDays?: number;
}

export class UpdateLeaveTypeDto extends PartialType(CreateLeaveTypeDto) {}

export class CreateLeaveRequestDto {
  @IsString() leaveTypeId: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsString() reason?: string;
}

export class QueryLeaveRequestsDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']) status?: string;
}

export class QueryLeaveBalancesDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}

export class SetLeaveAllocationDto {
  @IsString() employeeId: string;
  @IsString() leaveTypeId: string;
  @IsInt() @Min(2000) @Max(2100) year: number;
  @IsNumber() @Min(0) allocatedDays: number;
}
