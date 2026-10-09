import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationError } from 'class-validator';
import { AppError } from '@flight13/shared';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { MetaModule } from './modules/meta/meta.module';
import { AirportsModule } from './modules/flights/airports.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { FlightsModule } from './modules/flights/flights.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TicketingModule } from './modules/ticketing/ticketing.module';
import { CheckInModule } from './modules/checkin/checkin.module';
import { JobsModule } from './jobs/jobs.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AppExceptionFilter } from './common/filters/app-exception.filter';

/** class-validator → the API's shared error envelope (422 VALIDATION_ERROR). */
function validationExceptionFactory(errors: ValidationError[]): AppError {
  const details = errors.flatMap((error) =>
    Object.entries(error.constraints ?? {}).map(([constraint, message]) => ({
      property: error.property,
      constraint,
      message,
    })),
  );
  return new AppError('VALIDATION_ERROR', 'Request validation failed', details);
}

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    HealthModule,
    MetaModule,
    AirportsModule,
    AuthModule,
    UsersModule,
    FlightsModule,
    BookingsModule,
    PaymentsModule,
    RealtimeModule,
    TicketingModule,
    CheckInModule,
    JobsModule,
  ],
  providers: [
    // Order matters: authentication first, then role checks against req.user.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: validationExceptionFactory,
      }),
    },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
