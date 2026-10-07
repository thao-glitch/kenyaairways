import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdminUserDto, Paginated } from '@flight13/shared';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.module';

const MAX_PAGE_SIZE = 100;

@Controller('admin')
@ApiTags('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  /** User directory for support/ops — ADMIN only. */
  @Get('users')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List user accounts (ADMIN)' })
  @ApiOkResponse({ description: 'Paginated directory' })
  async listUsers(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ): Promise<Paginated<AdminUserDto>> {
    const pageNo = Math.max(1, Number.parseInt(page, 10) || 1);
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(pageSize, 10) || 20));
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (pageNo - 1) * size,
        take: size,
      }),
    ]);
    return {
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        status: u.status,
        locale: u.locale,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      page: pageNo,
      pageSize: size,
      total,
      hasMore: pageNo * size < total,
    };
  }
}

@Module({
  controllers: [AdminController],
})
export class UsersModule {}
