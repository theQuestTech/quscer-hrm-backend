import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PointDto {
  @IsDateString() at: string;
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracy?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) battery?: number;
}

// The phone sends what it collected since last time (it keeps them while offline).
export class PointsDto {
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => PointDto) points: PointDto[];
}

export class TrackingEventDto {
  @IsIn(['LOCATION_OFF', 'LOCATION_ON', 'PERMISSION_DENIED']) kind: string;
  @IsOptional() @IsDateString() at?: string;
}

export class StartVisitDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) place: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracy?: number;
}

export class EndVisitDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;
}

export class RouteQueryDto {
  @IsOptional() @IsString() @MaxLength(40) employeeId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' }) date?: string;
}

export class TrackingSettingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(60) intervalMinutes?: number;
  @IsOptional() @IsInt() @Min(7) @Max(365) keepDays?: number;
}
