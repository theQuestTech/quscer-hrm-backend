import { IsDateString, IsOptional, IsString } from 'class-validator';

export class QueryAttendanceDto {
  @IsOptional()
  @IsString()
  employeeId?: string; // omit to default to the caller's own record (self-service)

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class QueryRegisterDto {
  @IsOptional()
  @IsDateString()
  date?: string; // omit for today in the org's timezone
}
