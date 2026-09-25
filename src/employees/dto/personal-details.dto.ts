import { IsDateString, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Personal details on an employee record. Every field is optional; sending
// null clears it.
export class PersonalDetailsDto {
  @IsOptional() @IsString() @MaxLength(100) fatherName?: string | null;
  @IsOptional() @Matches(/^\d{5}-\d{7}-\d$/, { message: 'CNIC must look like 35202-1234567-1' }) cnic?: string | null;
  @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) gender?: string | null;
  @IsOptional() @IsIn(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']) maritalStatus?: string | null;
  @IsOptional() @IsIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']) bloodGroup?: string | null;
  @IsOptional() @IsEmail() personalEmail?: string | null;
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @IsString() @MaxLength(60) city?: string | null;
}

// What an employee may change about themselves on My Profile. Job details,
// pay and bank account stay with HR.
export class SelfProfileDto extends PersonalDetailsDto {
  @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @IsDateString() dateOfBirth?: string | null;
}
