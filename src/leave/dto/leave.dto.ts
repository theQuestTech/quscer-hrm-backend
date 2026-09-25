import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { LeaveAccrual } from '@prisma/client';

export class CreateLeaveTypeDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsInt() @Min(0) defaultAnnualDays?: number;
  @IsOptional() @IsEnum(LeaveAccrual) accrual?: LeaveAccrual;
  @IsOptional() @IsNumber() @Min(0) @Max(365) maxCarryForwardDays?: number;
  @IsOptional() @IsBoolean() isEncashable?: boolean;
  @IsOptional() @IsBoolean() allowNegativeBalance?: boolean;
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
  @IsOptional() @IsIn(['PENDING', 'FIRST_APPROVED', 'APPROVED', 'REJECTED', 'CANCELLED']) status?: string;
}

export class QueryLeaveBalancesDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}

export class SetLeaveAllocationDto {
  @IsString() employeeId: string;
  @IsString() leaveTypeId: string;
  @IsInt() @Min(2000) @Max(2100) year: number;
  // null clears a manual override so the leave type's rules apply again.
  @ValidateIf((o) => o.allocatedDays !== null) @IsNumber() @Min(0) allocatedDays: number | null;
}
