import { IsNumber, IsOptional, Max, Min } from 'class-validator';

// Sent by the slide button when the phone/browser shares its location.
export class CheckInLocationDto {
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracy?: number;
}
