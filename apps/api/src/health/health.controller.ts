import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; postgis: string }> {
    try {
      const [row] = await this.prisma.$queryRaw<
        { version: string }[]
      >`SELECT PostGIS_Lib_Version() AS version`;
      return { status: 'ok', postgis: row?.version ?? 'unknown' };
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
  }
}
