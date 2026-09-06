import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateLeaveTypeDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsInt() @Min(0) defaultAnnualDays?: number;
}

export class CreateLeaveRequestDto {
  @IsString() leaveTypeId: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsString() reason?: string;
}

export class QueryLeaveRequestsDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() status?: string;
}
