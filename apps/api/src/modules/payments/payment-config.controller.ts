import { Body, Controller, Delete, Get, Param, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional } from 'class-validator';
import { AppError, type PaymentMethodConfigDto, type PaymentPlanDto } from '@kenyaairways/shared';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthedRequest, AuthUser } from '../../common/auth-request';
import { actorFromUser, type BookingActor } from '../bookings/bookings.service';
import { MethodConfigService, type EffectivePlan } from './config/method-config.service';

const METHODS = ['MPESA_STK', 'MPESA_C2B', 'STRIPE', 'MOCK'] as const;

export class SetDefaultProviderDto {
  @ApiProperty({
    description: 'Method NEW payments are created with (in-flight payments keep theirs)',
    enum: METHODS,
  })
  @IsIn(METHODS)
  defaultProvider!: (typeof METHODS)[number];
}

export class UpdatePaymentMethodDto {
  @ApiPropertyOptional({ description: 'Accept new payments through this method' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Non-secret settings (mode, mpesaEnv, shortcode, callbackBaseUrl, allowedCallbackIps, initiatorName). Omitted keys keep their value; "" clears an override so the env default applies again.',
    example: { mpesaEnv: 'sandbox', shortcode: '174379' },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Secret fields (consumerKey, consumerSecret, passkey, securityCredential / secretKey, webhookSecret). Omitted keys are kept; "" clears one. Write-only — reads return masks.',
    example: { passkey: 'new-passkey-value' },
  })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string>;
}

/**
 * Admin "payment plans" — configure payment methods at runtime. Changes are
 * stored as DB overrides over the environment defaults, audited, and picked
 * up by every instance within the config TTL (no restart). They only affect
 * NEW payments: each Payment keeps the method it was created with for
 * query/refund/callback processing, and the neutral callback-path secret
 * stays env-only so in-flight Daraja callbacks never break.
 */
@ApiBearerAuth()
@ApiTags('admin')
@Controller('admin/payment-config')
export class PaymentConfigController {
  constructor(private readonly methods: MethodConfigService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Effective payment plan: default method + all methods (secrets masked)',
  })
  @ApiOkResponse({ description: 'Masked effective configuration' })
  async plan(): Promise<PaymentPlanDto> {
    return this.methods.toMasked(await this.methods.plan());
  }

  @Patch('default')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Choose the method new payments are created with' })
  @ApiOkResponse({ description: 'Updated plan' })
  async setDefault(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetDefaultProviderDto,
    @Req() req: AuthedRequest,
  ): Promise<PaymentPlanDto> {
    await this.methods.setDefault(dto.defaultProvider, this.actor(user, req));
    return this.methods.toMasked(await this.methods.plan());
  }

  @Get(':provider')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'One payment method (secrets masked)' })
  @ApiOkResponse({ description: 'Masked effective configuration' })
  async method(@Param('provider') provider: string): Promise<PaymentMethodConfigDto> {
    return this.masked(await this.methods.plan(), provider);
  }

  @Patch(':provider')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a payment method (partial — omit to keep current values)' })
  @ApiOkResponse({ description: 'Masked effective configuration after the change' })
  async update(
    @Param('provider') provider: string,
    @Body() dto: UpdatePaymentMethodDto,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
  ): Promise<PaymentMethodConfigDto> {
    const updated = await this.methods.updateMethod(
      provider,
      { enabled: dto.enabled, settings: dto.settings, secrets: dto.secrets },
      this.actor(user, req),
    );
    return this.masked(await this.methods.plan(), updated.provider);
  }

  @Delete(':provider')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Revert a payment method to environment defaults' })
  @ApiOkResponse({ description: 'Masked effective configuration after the revert' })
  async revert(
    @Param('provider') provider: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
  ): Promise<PaymentMethodConfigDto> {
    const reverted = await this.methods.revertMethod(provider, this.actor(user, req));
    return this.masked(await this.methods.plan(), reverted.provider);
  }

  private masked(plan: EffectivePlan, provider: string): PaymentMethodConfigDto {
    const dto = this.methods
      .toMasked(plan)
      .methods.find(
        (m) => m.provider === provider || (provider === 'MPESA_C2B' && m.provider === 'MPESA_STK'),
      );
    if (!dto) throw new AppError('NOT_FOUND', `Unknown payment method ${provider}`);
    return dto;
  }

  private actor(user: AuthUser, req: AuthedRequest): BookingActor {
    const header = req.headers['x-request-id'];
    return actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined);
  }
}
