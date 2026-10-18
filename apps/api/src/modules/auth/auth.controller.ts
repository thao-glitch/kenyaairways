import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { OtpPurpose } from '@prisma/client';
import type { Request, Response } from 'express';
import type { MobileSessionDto, SessionUserDto } from '@flight13/shared';
import { getEnv } from '../../config/env';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser, AuthedRequest } from '../../common/auth-request';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { REFRESH_COOKIE, TokenService } from './token.service';
import { LoginDto, OtpRequestDto, OtpVerifyDto, RegisterDto } from './dto/auth.dto';

interface SessionResponse {
  user: SessionUserDto;
  /** Present only for native clients (`X-Client: mobile`) — tokens in body. */
  session?: MobileSessionDto;
}

/** Native apps cannot keep httpOnly cookies across restarts — body tokens. */
export class MobileRefreshDto {
  @ApiPropertyOptional({ description: 'Refresh token from the login/register body' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  refreshToken?: string;
}

/** True when the caller is the mobile app asking for body-borne tokens. */
function wantsMobileSession(req: Request): boolean {
  const client = req.headers['x-client'];
  return client === 'mobile';
}

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create a passenger account and start a session' })
  @ApiResponse({ status: 201, description: 'Account created; set-cookie carries the session' })
  @ApiResponse({ status: 409, description: 'Email or phone already registered' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const { session, user } = await this.auth.register(dto, meta(req));
    this.tokens.setCookies(res, session);
    return { user, ...(wantsMobileSession(req) ? { session: mobileSession(session, user) } : {}) };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange credentials for an httpOnly session' })
  @ApiOkResponse({ description: 'Session established via set-cookie' })
  @ApiResponse({ status: 401, description: 'Incorrect credentials' })
  @ApiResponse({ status: 423, description: 'Account locked after repeated failures' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    const { session, user } = await this.auth.login(dto, meta(req));
    this.tokens.setCookies(res, session);
    return { user, ...(wantsMobileSession(req) ? { session: mobileSession(session, user) } : {}) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and mint a new access token' })
  @ApiResponse({ status: 401, description: 'Missing, expired or replayed refresh token' })
  async refresh(
    @Req() req: Request,
    @Body() dto: MobileRefreshDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ rotated: true; session?: MobileSessionDto }> {
    // Mobile clients post the token (no cookie jar); browsers use the cookie.
    const raw =
      dto.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const issued = await this.auth.refresh(raw, meta(req as AuthedRequest));
    this.tokens.setCookies(res, issued);
    if (!wantsMobileSession(req)) return { rotated: true };
    // The new access token names its subject — load that user for the body.
    const claims = await this.tokens.verifyAccess(issued.accessToken);
    const user = await this.auth.me(claims.sub);
    return { rotated: true, session: mobileSession(issued, user) };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the refresh-token family and clear cookies' })
  async logout(
    @Req() req: Request,
    @Body() dto: MobileRefreshDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // Mobile clients post the refresh token to revoke their own family.
    const raw =
      dto.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    await this.auth.logout(raw, meta(req as AuthedRequest));
    this.tokens.clearCookies(res);
  }

  @Get('me')
  @ApiOperation({ summary: 'The authenticated user (session probe for the web app)' })
  @ApiOkResponse({ type: Object })
  async me(@CurrentUser() user: AuthUser): Promise<SessionUserDto> {
    return this.auth.me(user.id);
  }

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a 6-digit OTP by SMS or email (MFA-ready)' })
  @ApiResponse({ status: 202, description: 'Code dispatched (rate-limited per destination)' })
  async requestOtp(@Body() dto: OtpRequestDto): Promise<{ expiresInSeconds: number }> {
    const result = await this.otp.request(dto.destination, dto.purpose);
    return { expiresInSeconds: result.expiresInSeconds };
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Consume a 6-digit OTP' })
  @ApiResponse({ status: 200, description: 'Verified' })
  @ApiResponse({ status: 401, description: 'Incorrect code' })
  @ApiResponse({ status: 410, description: 'Code expired' })
  async verifyOtp(@Body() dto: OtpVerifyDto): Promise<{ verified: true }> {
    const result = await this.otp.verify(dto.destination, dto.purpose, dto.code);
    return { verified: result.verified };
  }

  @Public()
  @Get('otp/preview')
  @ApiOperation({
    summary: 'Read the outstanding OTP code (MOCK SMS mode only — dev/demo helper)',
  })
  @ApiOkResponse({ description: 'The plaintext code stashed for the mock SMS sink' })
  @ApiResponse({ status: 404, description: 'Not available unless SMS_PROVIDER=mock' })
  async previewOtp(
    @Query('destination') destination: string,
    @Query('purpose') purpose: OtpPurpose,
  ): Promise<{ code: string }> {
    return this.otp.preview(destination, purpose);
  }
}

function meta(req: AuthedRequest): {
  ip: string | undefined;
  userAgent: string | undefined;
  requestId: string | undefined;
} {
  const header = req.headers['x-request-id'];
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    requestId: typeof header === 'string' ? header : undefined,
  };
}

/** Body-borne token pair for native clients (same JWTs the cookies carry). */
function mobileSession(
  session: { accessToken: string; refreshToken: string },
  user: SessionUserDto,
): MobileSessionDto {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresInSec: getEnv().ACCESS_TOKEN_TTL,
    user,
  };
}
