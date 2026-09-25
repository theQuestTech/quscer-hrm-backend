import { IsString, MinLength } from 'class-validator';

export class SwitchCompanyDto {
  @IsString() organizationId: string;
}

export class AddCompanyDto {
  @IsString() @MinLength(2) organizationName: string;
}
