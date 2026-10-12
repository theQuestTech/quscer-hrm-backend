import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional } from 'class-validator';

// Rows as read from the spreadsheet: column key → cell text.
export class ImportEmployeesDto {
  @IsArray() @ArrayMaxSize(2000) @IsObject({ each: true }) rows: Record<string, string>[];
  // Give each person a login and email them to choose a password.
  @IsOptional() @IsBoolean() giveLogin?: boolean;
}
