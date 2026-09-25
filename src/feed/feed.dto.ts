import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// Sent as multipart/form-data together with up to 4 pictures, so booleans
// arrive as the strings "true"/"false".
export class CreatePostDto {
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @IsOptional() @IsIn(['POST', 'ANNOUNCEMENT']) kind?: 'POST' | 'ANNOUNCEMENT';
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() pin?: boolean;
}

export class PinPostDto {
  @IsBoolean() isPinned: boolean;
}

export class CreateCommentDto {
  @IsString() @MinLength(1) @MaxLength(2000) body: string;
}

export class FeedQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
