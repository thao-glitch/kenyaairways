import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { OtpPurpose } from '@prisma/client';
import type { Request, Response } from 'express';
import type { SessionUserDto } from '@flight13/shared';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser, AuthedRequest } from '../../common/auth-request';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { REFRESH_COOKIE, TokenService } from './token.service';
import { LoginDto, OtpRequestDto, OtpVerifyDto, RegisterDto } from './dto/auth.dto';

interface SessionResponse {
  user: SessionUserDto;
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
    return { user };
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
    return { user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and mint a new access token' })
  @ApiResponse({ status: 401, description: 'Missing, expired or replayed refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ rotated: true }> {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const session = await this.auth.refresh(raw, meta(req as AuthedRequest));
    this.tokens.setCookies(res, session);
    return { rotated: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the refresh-token family and clear cookies' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
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
