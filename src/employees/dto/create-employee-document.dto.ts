import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

// A document that lives elsewhere (e.g. a shared drive link).
export class CreateEmployeeDocumentDto {
  @IsString() @MinLength(1) category: string; // "CNIC", "Contract", "Degree", etc.
  @IsString() @MinLength(1) fileUrl: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}

// The form fields that come with an uploaded file (multipart/form-data).
export class UploadEmployeeDocumentDto {
  @IsString() @MinLength(1) category: string;
  @IsOptional() @IsDateString() expiryDate?: string;
}
