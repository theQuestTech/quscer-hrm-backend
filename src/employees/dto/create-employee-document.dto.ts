import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEmployeeDocumentDto {
  @IsString() @MinLength(1) category: string; // "CNIC", "Contract", "Degree", etc.
  @IsString() @MinLength(1) fileUrl: string; // upload/storage service not built yet — pass an already-hosted URL for now
  @IsOptional() @IsDateString() expiryDate?: string;
}
