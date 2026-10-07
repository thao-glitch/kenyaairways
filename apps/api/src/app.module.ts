import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { MetaModule } from './modules/meta/meta.module';
import { AirportsModule } from './modules/flights/airports.module';

@Module({
  imports: [PrismaModule, RedisModule, HealthModule, MetaModule, AirportsModule],
})
export class AppModule {}
