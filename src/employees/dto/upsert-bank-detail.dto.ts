import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertBankDetailDto {
  @IsString() @MinLength(1) bankName: string;
  @IsString() @MinLength(1) accountTitle: string;
  @IsString() @MinLength(1) accountNumber: string; // encrypted before it's stored — see FieldEncryptionService
  @IsOptional() @IsString() branchCode?: string;
}
