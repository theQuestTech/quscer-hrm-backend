import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;

  // From "Trust this computer for 30 days" — skips the code step.
  @IsOptional()
  @IsString()
  trustedDeviceToken?: string;
}

export class LoginTwoStepDto {
  @IsString()
  challengeToken: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  backupCode?: string;

  @IsOptional()
  @IsBoolean()
  trustDevice?: boolean;
}
