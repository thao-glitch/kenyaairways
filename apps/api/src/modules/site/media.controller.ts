import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { AppError } from '@flight13/shared';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthedRequest, AuthUser } from '../../common/auth-request';
import { actorFromUser } from '../bookings/bookings.service';
import { MAX_UPLOAD_BYTES, MediaService, type UploadedImage } from './media.service';

/**
 * Photograph uploads for the appearance console. Admins replace any site
 * image by uploading a file — the stored settings only ever reference the
 * returned public path, which this controller also serves.
 */
@ApiBearerAuth()
@ApiTags('meta')
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('admin/media')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES * 2 } }))
  @ApiOperation({ summary: 'Upload a photograph (JPEG/PNG/WebP/GIF/AVIF, max 5 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({
    description: 'Public path of the stored upload',
    schema: { example: { url: '/api/v1/media/0123456789abcdef0123456789abcdef.jpg' } },
  })
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedImage | undefined,
    @Req() req: AuthedRequest,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Attach the image as form field "file"');
    }
    const header = req.headers['x-request-id'];
    const actor = actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined);
    return { url: await this.media.save(actor, file) };
  }

  @Public()
  @Get('media/:file')
  @ApiOperation({ summary: 'Serve an uploaded photograph' })
  async serve(@Param('file') name: string, @Res() res: Response): Promise<void> {
    const found = await this.media.resolve(name);
    if (!found) throw new AppError('NOT_FOUND', 'No such media file');
    res.setHeader('content-type', found.mimetype);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    createReadStream(found.path).pipe(res);
  }
}
