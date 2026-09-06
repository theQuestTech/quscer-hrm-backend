import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertBankDetailDto {
  @IsString() @MinLength(1) bankName: string;
  @IsString() @MinLength(1) accountTitle: string;
  @IsString() @MinLength(1) accountNumber: string; // TODO: encrypt before production use (task 6.12)
  @IsOptional() @IsString() branchCode?: string;
}
