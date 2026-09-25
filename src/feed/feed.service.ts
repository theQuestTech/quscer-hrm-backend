// Company feed: anyone in the company can post (text and up to 4 pictures),
// like and comment. HR (hrm.settings.write) can also post announcements,
// pin posts to the top and remove anyone's post or comment. Birthday posts
// are created automatically the first time the feed is opened on the day —
// no background job needed.

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, FeedPostKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { findActiveMembership } from '../common/membership';
import { todayInTimeZone } from '../common/dates';
import { birthdayKey, birthdayMessage, hasBirthdayOn } from './birthdays';

export const MAX_IMAGES_PER_POST = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PINNED = 5;
const MODERATOR_PERMISSION = 'hrm.settings.write';

export function sniffImageType(buffer: Buffer): string | null {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

type Caller = { id: string; organizationId: string };

const personSelect = { select: { id: true, firstName: true, lastName: true } } as const;

@Injectable()
export class FeedService {
  constructor(
    private prisma: PrismaService,
    private rbac: RbacService,
  ) {}

  // Anyone with active access to the company, whatever their roles.
  private async access(caller: Caller) {
    if (!(await findActiveMembership(this.prisma, caller.id, caller.organizationId))) {
      throw new ForbiddenException("You don't have access to this company");
    }
    const permissions = await this.rbac.getEffectivePermissions(caller.id, caller.organizationId);
    return { isModerator: permissions.has(MODERATOR_PERMISSION) };
  }

  async list(caller: Caller, cursor?: string, limit = 20) {
    const { isModerator } = await this.access(caller);
    await this.createBirthdayPosts(caller.organizationId);

    const include = {
      author: personSelect,
      subjectEmployee: personSelect,
      images: { select: { id: true }, orderBy: { position: 'asc' as const } },
      likes: { where: { userId: caller.id }, select: { userId: true } },
      _count: { select: { likes: true, comments: true } },
    };
    const [pinned, page] = await Promise.all([
      cursor
        ? Promise.resolve([])
        : this.prisma.feedPost.findMany({
            where: { organizationId: caller.organizationId, isPinned: true },
            orderBy: { createdAt: 'desc' },
            take: MAX_PINNED,
            include,
          }),
      this.prisma.feedPost.findMany({
        where: { organizationId: caller.organizationId, isPinned: false },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        include,
      }),
    ]);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;

    const shape = (p: (typeof page)[number]) => ({
      id: p.id,
      kind: p.kind,
      body: p.body,
      isPinned: p.isPinned,
      createdAt: p.createdAt,
      author: p.author,
      subjectEmployee: p.subjectEmployee,
      imageIds: p.images.map((i) => i.id),
      likeCount: p._count.likes,
      commentCount: p._count.comments,
      likedByMe: p.likes.length > 0,
      canDelete: isModerator || (p.authorUserId !== null && p.authorUserId === caller.id),
      canPin: isModerator,
    });
    return {
      pinned: pinned.map(shape),
      items: items.map(shape),
      nextCursor: hasMore ? items[items.length - 1].id : null,
      canAnnounce: isModerator,
    };
  }

  async create(caller: Caller, dto: { body?: string; kind?: 'POST' | 'ANNOUNCEMENT'; pin?: boolean }, files: Express.Multer.File[] = []) {
    const { isModerator } = await this.access(caller);
    const body = (dto.body ?? '').trim();
    if (!body && files.length === 0) throw new BadRequestException('Write something or add a picture');
    if (files.length > MAX_IMAGES_PER_POST) throw new BadRequestException(`You can add up to ${MAX_IMAGES_PER_POST} pictures`);
    const kind = dto.kind === 'ANNOUNCEMENT' ? FeedPostKind.ANNOUNCEMENT : FeedPostKind.POST;
    if ((kind === FeedPostKind.ANNOUNCEMENT || dto.pin) && !isModerator) {
      throw new ForbiddenException('Only HR can post announcements or pin posts');
    }

    const images = files.map((file, position) => {
      if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Each picture can be at most 5 MB');
      const mimeType = sniffImageType(file.buffer);
      if (!mimeType) throw new BadRequestException('Pictures must be JPG, PNG or WebP');
      return { position, mimeType, sizeBytes: file.size, data: file.buffer };
    });

    const post = await this.prisma.feedPost.create({
      data: {
        organizationId: caller.organizationId,
        authorUserId: caller.id,
        kind,
        body,
        isPinned: !!dto.pin,
        images: { create: images },
      },
    });
    if (post.isPinned) await this.trimPinned(caller.organizationId);
    return { id: post.id };
  }

  async setPinned(caller: Caller, postId: string, isPinned: boolean) {
    const { isModerator } = await this.access(caller);
    if (!isModerator) throw new ForbiddenException('Only HR can pin posts');
    await this.findPost(caller, postId);
    await this.prisma.feedPost.update({ where: { id: postId }, data: { isPinned } });
    if (isPinned) await this.trimPinned(caller.organizationId);
    return { id: postId, isPinned };
  }

  async remove(caller: Caller, postId: string) {
    const { isModerator } = await this.access(caller);
    const post = await this.findPost(caller, postId);
    if (!isModerator && post.authorUserId !== caller.id) {
      throw new ForbiddenException('You can only delete your own posts');
    }
    await this.prisma.feedPost.delete({ where: { id: postId } });
    if (post.authorUserId !== caller.id) {
      await this.audit(caller, 'feed.post_removed', postId, { authorUserId: post.authorUserId });
    }
    return { deleted: true };
  }

  async image(caller: Caller, imageId: string) {
    await this.access(caller);
    const image = await this.prisma.feedImage.findFirst({
      where: { id: imageId, post: { organizationId: caller.organizationId } },
    });
    if (!image) throw new NotFoundException('Picture not found');
    return image;
  }

  async like(caller: Caller, postId: string, liked: boolean) {
    await this.access(caller);
    await this.findPost(caller, postId);
    if (liked) {
      await this.prisma.feedLike.upsert({
        where: { postId_userId: { postId, userId: caller.id } },
        create: { postId, userId: caller.id },
        update: {},
      });
    } else {
      await this.prisma.feedLike.deleteMany({ where: { postId, userId: caller.id } });
    }
    const likeCount = await this.prisma.feedLike.count({ where: { postId } });
    return { likedByMe: liked, likeCount };
  }

  async likes(caller: Caller, postId: string) {
    await this.access(caller);
    await this.findPost(caller, postId);
    const likes = await this.prisma.feedLike.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: { user: personSelect },
    });
    return likes.map((l) => l.user);
  }

  async comments(caller: Caller, postId: string) {
    const { isModerator } = await this.access(caller);
    await this.findPost(caller, postId);
    const comments = await this.prisma.feedComment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: { author: personSelect },
    });
    return comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: c.author,
      canDelete: isModerator || c.authorUserId === caller.id,
    }));
  }

  async addComment(caller: Caller, postId: string, body: string) {
    await this.access(caller);
    await this.findPost(caller, postId);
    const text = body.trim();
    if (!text) throw new BadRequestException('Write a comment first');
    const comment = await this.prisma.feedComment.create({
      data: { postId, authorUserId: caller.id, body: text },
      include: { author: personSelect },
    });
    return { id: comment.id, body: comment.body, createdAt: comment.createdAt, author: comment.author, canDelete: true };
  }

  async removeComment(caller: Caller, commentId: string) {
    const { isModerator } = await this.access(caller);
    const comment = await this.prisma.feedComment.findFirst({
      where: { id: commentId, post: { organizationId: caller.organizationId } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (!isModerator && comment.authorUserId !== caller.id) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.prisma.feedComment.delete({ where: { id: commentId } });
    if (comment.authorUserId !== caller.id) {
      await this.audit(caller, 'feed.comment_removed', commentId, { authorUserId: comment.authorUserId });
    }
    return { deleted: true };
  }

  // --- internals ----------------------------------------------------------

  private async findPost(caller: Caller, postId: string) {
    const post = await this.prisma.feedPost.findFirst({ where: { id: postId, organizationId: caller.organizationId } });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  // Keep the pinned area short: unpin the oldest beyond the limit.
  private async trimPinned(organizationId: string) {
    const pinned = await this.prisma.feedPost.findMany({
      where: { organizationId, isPinned: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const extra = pinned.slice(MAX_PINNED).map((p) => p.id);
    if (extra.length) await this.prisma.feedPost.updateMany({ where: { id: { in: extra } }, data: { isPinned: false } });
  }

  private async createBirthdayPosts(organizationId: string) {
    const [settings, organization] = await Promise.all([
      this.prisma.organizationLocaleSettings.findUnique({ where: { organizationId } }),
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
    ]);
    if (settings && !settings.birthdayPostsEnabled) return;
    const today = todayInTimeZone(settings?.defaultTimezone);
    const employees = await this.prisma.employee.findMany({
      where: {
        organizationId,
        dateOfBirth: { not: null },
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE] },
      },
      select: { id: true, firstName: true, dateOfBirth: true },
    });
    const due = employees.filter((e) => hasBirthdayOn(e.dateOfBirth!, today));
    if (due.length === 0) return;
    await this.prisma.feedPost.createMany({
      data: due.map((e) => ({
        organizationId,
        kind: FeedPostKind.BIRTHDAY,
        subjectEmployeeId: e.id,
        body: birthdayMessage(e.firstName, organization?.name ?? 'the company'),
        autoKey: birthdayKey(e.id, today),
      })),
      skipDuplicates: true,
    });
  }

  private audit(caller: Caller, eventType: string, entityId: string, metadata: Prisma.InputJsonObject) {
    return this.prisma.auditEvent.create({
      data: {
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        eventType,
        entityType: eventType === 'feed.post_removed' ? 'FeedPost' : 'FeedComment',
        entityId,
        metadata,
      },
    });
  }
}
