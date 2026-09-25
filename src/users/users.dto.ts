import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class SetUserRolesDto {
  @IsArray() @ArrayUnique() @IsString({ each: true }) roleIds: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// Either create a new login for the employee (password) or link an existing
// user account to them (userId — e.g. the HR admin who signed up and now
// wants their own employee profile for check-in and payslips).
export class GrantLoginAccessDto {
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) roleIds?: string[];
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) newPassword: string;
}

// Add a person to this company who isn't an employee (outsourced HR,
// accountant). password is only used when the email has no login yet.
export class AddPersonDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsString({ each: true }) roleIds: string[];
}
