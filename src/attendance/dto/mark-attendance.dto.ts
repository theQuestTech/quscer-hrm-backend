import { IsDateString, IsEnum, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

export class MarkAttendanceDto {
  @IsString() employeeId: string;
  @IsDateString() date: string;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
  @IsOptional() @IsString() notes?: string;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class RequestCorrectionDto {
  @IsDateString() date: string;
  @IsOptional() @Matches(HH_MM, { message: 'checkInTime must be HH:mm' }) checkInTime?: string;
  @IsOptional() @Matches(HH_MM, { message: 'checkOutTime must be HH:mm' }) checkOutTime?: string;
  @IsString() @MinLength(3) reason: string;
}

export class QueryCorrectionsDto {
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED']) status?: string;
}
