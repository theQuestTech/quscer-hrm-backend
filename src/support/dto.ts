import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// --- Support staff sign-in ---------------------------------------------------

export class SupportLoginDto {
  @IsEmail() @MaxLength(200) email: string;
  @IsString() @MaxLength(200) password: string;
}

export class SupportLoginTwoStepDto {
  @IsString() @MaxLength(1000) challengeToken: string;
  @IsOptional() @IsString() @MaxLength(20) code?: string;
  @IsOptional() @IsString() @MaxLength(20) backupCode?: string;
}

export class SupportTwoStepConfirmDto {
  @IsString() @MaxLength(20) code: string;
}

export class SupportForgotDto {
  @IsEmail() @MaxLength(200) email: string;
}

export class SupportResetDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string;
  // Staff can see every company, so their passwords are longer.
  @IsString() @MinLength(12) @MaxLength(200) newPassword: string;
}

export class AddAgentDto {
  @IsEmail() @MaxLength(200) email: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) name: string;
}

export class UpdateAgentDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  // The name customers see, e.g. "Ali (Quscer support)".
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) name?: string;
}

// --- Console actions ------------------------------------------------------------

export class SuspendDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class ViewAsDto {
  @IsString() @MaxLength(40) organizationId: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

export class AgentReplyDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(10000) body: string;
  @IsOptional() @IsBoolean() close?: boolean;
}

export class TicketStatusDto {
  @IsIn(['OPEN', 'ANSWERED', 'CLOSED']) status: 'OPEN' | 'ANSWERED' | 'CLOSED';
}

// --- Customers: "Get help" --------------------------------------------------------

export class NewTicketDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(150) subject: string;
  @Transform(trim) @IsString() @MinLength(5) @MaxLength(10000) body: string;
  @IsOptional() @IsString() @MaxLength(300) page?: string;
}

export class CustomerReplyDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(10000) body: string;
}
