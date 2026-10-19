import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { AdminBookingSummaryDto, PaymentDto } from '@flight13/shared';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/auth-request';
import { PrismaService } from '../../prisma/prisma.module';
import { actorFromUser, type BookingActor } from '../bookings/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { RecordPaymentDto } from './dto/admin.dto';

const MAX_LIST = 60;

/**
 * Assistance desk: find any booking (PNR, e-mail or passenger name) and do
 * the whole journey for the customer — including taking money directly at the
 * counter and letting the console record it like any other confirmation.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.AGENT, Role.FINANCE)
  @ApiOperation({ summary: 'Recent bookings searchable by PNR, e-mail or passenger' })
  @ApiOkResponse({ description: 'Up to 60 bookings, newest first' })
  async list(@Query('q') q?: string): Promise<AdminBookingSummaryDto[]> {
    const term = q?.trim();
    // Name search: every word must land somewhere in first+last name, so
    // "walkin customer" and "customer, walkin" both find Walkin Customer.
    const words = term
      ? term
          .split(/[\s,]+/)
          .filter(Boolean)
          .slice(0, 6)
      : [];
    const bookings = await this.prisma.booking.findMany({
      where: term
        ? {
            OR: [
              { pnr: { contains: term.toUpperCase() } },
              { contactEmail: { contains: term, mode: 'insensitive' } },
              {
                passengers: {
                  some:
                    words.length > 0
                      ? {
                          AND: words.map((word) => ({
                            OR: [
                              { firstName: { contains: word, mode: 'insensitive' } },
                              { lastName: { contains: word, mode: 'insensitive' } },
                            ],
                          })),
                        }
                      : undefined,
                },
              },
            ],
          }
        : undefined,
      include: {
        passengers: { select: { firstName: true, lastName: true } },
        segments: {
          include: {
            flight: { select: { flightNumber: true } },
          },
          orderBy: { seq: 'asc' },
        },
        payments: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_LIST,
    });
    return bookings.map((b) => {
      const route = b.segments.length
        ? `${b.segments[0].originCode} → ${b.segments[b.segments.length - 1].destinationCode}`
        : '—';
      return {
        id: b.id,
        pnr: b.pnr,
        status: b.status,
        totalMinor: b.totalMinor,
        currency: b.currency as AdminBookingSummaryDto['currency'],
        contactEmail: b.contactEmail,
        contactPhone: b.contactPhone,
        passengerNames: b.passengers.map((p) => `${p.firstName} ${p.lastName}`.trim()),
        route,
        flightNumbers: b.segments.map((s) => s.flight.flightNumber),
        paid: b.payments.some((p) => p.status === 'PAID'),
        createdAt: b.createdAt.toISOString(),
      };
    });
  }

  @Post(':id/pay')
  @HttpCode(201)
  @Roles(Role.ADMIN, Role.AGENT, Role.FINANCE)
  @ApiOperation({ summary: 'Record money taken directly (cash/card at the counter)' })
  @ApiParam({ name: 'id', description: 'Booking id' })
  @ApiCreatedResponse({ description: 'Payment settled, booking CONFIRMED' })
  async recordPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ): Promise<PaymentDto> {
    const actor: BookingActor = actorFromUser(user);
    return this.payments.recordDirect(actor, id, {
      provider: dto.provider,
      amountMinor: dto.amountMinor,
      reference: dto.reference,
    });
  }
}
