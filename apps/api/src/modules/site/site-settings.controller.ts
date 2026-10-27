import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsIn, MaxLength } from 'class-validator';
import type { SiteSettingsDto } from '@kenyaairways/shared';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthedRequest, AuthUser } from '../../common/auth-request';
import { actorFromUser, type BookingActor } from '../bookings/bookings.service';
import { SITE_THEMES, SiteSettingsService } from './site-settings.service';

export class UpdateSiteSettingsDto {
  @ApiPropertyOptional({
    description: 'Live app name — renders across every surface immediately',
    example: 'Kenya Airways.',
    maxLength: 40,
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appName?: string;

  @ApiPropertyOptional({ description: 'Active theme', enum: SITE_THEMES })
  @IsOptional()
  @IsString()
  @IsIn(SITE_THEMES)
  theme?: string;

  @ApiPropertyOptional({
    description:
      'Image overrides ({ hero, auth, notFound, destinations: { <code>: url } }). Omitted keys keep their value; "" clears one back to the built-in default.',
    example: { hero: 'https://images.example.com/hero.jpg' },
  })
  @IsOptional()
  @IsObject()
  images?: Record<string, unknown>;
}

/**
 * Site appearance API. The public read powers the web app's theme class and
 * photographs and exposes the M-Pesa paybill from the active payment plan
 * (never secrets). The write side is ADMIN-only and audited.
 */
@ApiBearerAuth()
@ApiTags('meta')
@Controller()
export class SiteSettingsController {
  constructor(private readonly service: SiteSettingsService) {}

  @Public()
  @Get('site-settings')
  @ApiOperation({ summary: 'Public site appearance (theme, images, paybill)' })
  @ApiOkResponse({ description: 'Effective appearance for the web app' })
  async settings(): Promise<SiteSettingsDto> {
    return this.service.get();
  }

  @Patch('admin/site-settings')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update the theme and/or image overrides (partial)' })
  @ApiOkResponse({ description: 'Effective appearance after the change' })
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSiteSettingsDto,
    @Req() req: AuthedRequest,
  ): Promise<SiteSettingsDto> {
    const header = req.headers['x-request-id'];
    const actor: BookingActor = actorFromUser(
      user,
      req.ip,
      typeof header === 'string' ? header : undefined,
    );
    return this.service.update(actor, {
      appName: dto.appName,
      theme: dto.theme as SiteSettingsDto['theme'] | undefined,
      images: dto.images as SiteSettingsDto['images'] | undefined,
    });
  }
}
