import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min,
  MinLength, ValidateNested,
} from 'class-validator';
import { AttendanceDeviceKind } from '@prisma/client';

export class DeviceDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsEnum(AttendanceDeviceKind) kind: AttendanceDeviceKind;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{4,40}$/, { message: 'Serial numbers are 4–40 letters and numbers' }) serialNumber?: string;
  @IsOptional() @IsString() branchId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string | null;
}

export class UpdateDeviceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() branchId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// One punch sent by another system (API) or read from a file (IMPORT).
// `time` is either an exact moment with an offset ("2026-10-01T09:02:11+05:00")
// or the machine's local time ("2026-10-01 09:02:11").
class PunchInputDto {
  @IsString() @MinLength(1) @MaxLength(40) machineUserId: string;
  @IsString() @MaxLength(40) time: string;
  @IsOptional() @IsIn(['IN', 'OUT']) type?: 'IN' | 'OUT';
}

export class PunchBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => PunchInputDto)
  punches: PunchInputDto[];
}

export class ImportDto extends PunchBatchDto {
  @IsOptional() @IsString() deviceId?: string;
}

export class LinkDto {
  @IsString() employeeId: string;
}

export class NetworkDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsString() @MaxLength(60) cidr: string;
}

export class LocationDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(25) @Max(5000) radiusMeters?: number;
}
