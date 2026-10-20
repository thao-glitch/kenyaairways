import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '@kenyaairways/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { maskDeep } from '../../common/logger';
import type { BookingActor } from '../bookings/bookings.service';

/** Hard caps for appearance uploads (staff photographs, destination shots). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/** Accepted image types → stable file extension. */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]),
);

/** Public URL prefix stored in site settings; resolved against the API origin. */
export const MEDIA_PATH_PREFIX = '/api/v1/media/';
/** Stored filenames: 32 hex chars + extension — nothing else is servable. */
export const MEDIA_FILE_RE = /^[a-f0-9]{32}\.[a-z]{2,4}$/;

/** What multer gives us (memory storage). */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Filesystem-backed media store for the appearance console. Uploads land in
 * `UPLOAD_DIR` (default `<cwd>/uploads`) under a random name; settings only
 * ever store the public path, and replaced uploads are deleted so the disk
 * never accumulates orphans.
 */
@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly dir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

  /** Validate + persist one image; returns its public path. */
  async save(actor: BookingActor, file: UploadedImage): Promise<string> {
    const ext = MIME_EXT[file.mimetype];
    if (!ext) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Unsupported image type "${file.mimetype}" — use JPEG, PNG, WebP, GIF or AVIF`,
      );
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      throw new AppError('VALIDATION_ERROR', `Image must be 1-${MAX_UPLOAD_MB} MB`);
    }
    // Sniff the magic bytes: the declared mimetype alone is not trustworthy.
    if (!looksLikeImage(file.mimetype, file.buffer)) {
      throw new AppError('VALIDATION_ERROR', 'File content does not match an image');
    }
    const name = `${randomBytes(16).toString('hex')}.${ext}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, name), file.buffer);
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'media.upload',
          actorId: actor.userId,
          actorRole: actor.role,
          entityType: 'media',
          entityId: name,
          outcome: 'SUCCESS',
          ip: actor.ip,
          requestId: actor.requestId,
          metadata: maskDeep({
            bytes: file.size,
            mimetype: file.mimetype,
            originalname: file.originalname,
          }) as object,
        },
      });
    } catch {
      // audit must never fail the business action
    }
    return `${MEDIA_PATH_PREFIX}${name}`;
  }

  /** Resolve a stored public path to disk, or null when not servable. */
  async resolve(name: string): Promise<{ path: string; mimetype: string } | null> {
    if (!MEDIA_FILE_RE.test(name)) return null;
    const mimetype = EXT_MIME[name.split('.').pop()!];
    if (!mimetype) return null;
    const path = join(this.dir, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
    } catch {
      return null;
    }
    return { path, mimetype };
  }

  /** Best-effort delete of a stored upload given its public path. */
  async removeByUrl(url: unknown): Promise<void> {
    if (typeof url !== 'string' || !url.startsWith(MEDIA_PATH_PREFIX)) return;
    const name = url.slice(MEDIA_PATH_PREFIX.length);
    if (!MEDIA_FILE_RE.test(name)) return;
    try {
      await unlink(join(this.dir, name));
    } catch {
      /* already gone — nothing to do */
    }
  }
}

/** Magic-byte signatures for the accepted formats. */
function looksLikeImage(mimetype: string, buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG';
  const gif = buf.toString('ascii', 0, 4) === 'GIF8';
  const riff = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  const ftyp = buf.toString('ascii', 4, 8) === 'ftyp';
  if (mimetype === 'image/jpeg') return jpeg;
  if (mimetype === 'image/png') return png;
  if (mimetype === 'image/gif') return gif;
  if (mimetype === 'image/webp') return riff;
  if (mimetype === 'image/avif') return ftyp;
  return false;
}
