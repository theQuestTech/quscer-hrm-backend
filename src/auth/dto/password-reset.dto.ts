import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail() @MaxLength(200) email: string;
}

export class ResetPasswordWithTokenDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string;
  @IsString() @MinLength(8) @MaxLength(200) newPassword: string;
}
