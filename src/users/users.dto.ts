import { ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

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
