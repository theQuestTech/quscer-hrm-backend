import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeedService, MAX_IMAGE_BYTES, MAX_IMAGES_PER_POST } from './feed.service';
import { CreateCommentDto, CreatePostDto, FeedQueryDto, PinPostDto } from './feed.dto';

// Open to everyone in the company regardless of role — FeedService checks
// the caller still has access to the company on every call.
@Controller('feed')
@UseGuards(JwtAuthGuard)
export class FeedController {
  constructor(private feed: FeedService) {}

  @Get()
  list(@Req() req: any, @Query() query: FeedQueryDto) {
    return this.feed.list(req.user, query.cursor, query.limit);
  }

  // multipart/form-data: body, kind, pin + up to 4 "images".
  @Post('posts')
  @UseInterceptors(FilesInterceptor('images', MAX_IMAGES_PER_POST, { limits: { fileSize: MAX_IMAGE_BYTES + 1 } }))
  create(@Req() req: any, @Body() dto: CreatePostDto, @UploadedFiles() files: Express.Multer.File[]) {
    return this.feed.create(req.user, dto, files ?? []);
  }

  @Patch('posts/:id')
  pin(@Req() req: any, @Param('id') id: string, @Body() dto: PinPostDto) {
    return this.feed.setPinned(req.user, id, dto.isPinned);
  }

  @Delete('posts/:id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.feed.remove(req.user, id);
  }

  @Get('images/:id')
  async image(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const image = await this.feed.image(req.user, id);
    res.set({
      'Content-Type': image.mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    });
    res.send(Buffer.from(image.data));
  }

  @Post('posts/:id/like')
  like(@Req() req: any, @Param('id') id: string) {
    return this.feed.like(req.user, id, true);
  }

  @Delete('posts/:id/like')
  unlike(@Req() req: any, @Param('id') id: string) {
    return this.feed.like(req.user, id, false);
  }

  @Get('posts/:id/likes')
  likes(@Req() req: any, @Param('id') id: string) {
    return this.feed.likes(req.user, id);
  }

  @Get('posts/:id/comments')
  comments(@Req() req: any, @Param('id') id: string) {
    return this.feed.comments(req.user, id);
  }

  @Post('posts/:id/comments')
  addComment(@Req() req: any, @Param('id') id: string, @Body() dto: CreateCommentDto) {
    return this.feed.addComment(req.user, id, dto.body);
  }

  @Delete('comments/:id')
  removeComment(@Req() req: any, @Param('id') id: string) {
    return this.feed.removeComment(req.user, id);
  }
}
