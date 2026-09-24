import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEmergencyContactDto {
  @IsString() @MinLength(1) name: string;
  @IsString() @MinLength(1) relationship: string;
  @IsString() @MinLength(1) phone: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}
