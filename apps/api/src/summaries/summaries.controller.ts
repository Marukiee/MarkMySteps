import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import type { Response as ExpressResponse } from 'express';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SummariesService, TripSummaryInfo } from './summaries.service';

class RenameSummaryDto {
  @IsString()
  @Length(1, 120)
  title!: string;
}

/** 8 MB a page: a 1080x1920 JPEG is a tenth of that, PNG a third. */
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 12;

@Controller('trips/:tripId/summaries')
@UseGuards(JwtAuthGuard)
export class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<TripSummaryInfo[]> {
    return this.summaries.list(tripId, user.sub);
  }

  /**
   * The pages arrive as `pages[]`, already rendered. The rest of the form is
   * the recipe: title, layout, the period in words, and the spec the app can
   * use to build the same thing again.
   */
  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseInterceptors(FilesInterceptor('pages', MAX_PAGES, { limits: { fileSize: MAX_PAGE_BYTES } }))
  async create(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() body: Record<string, string>,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<TripSummaryInfo> {
    if (!files || files.length === 0) throw new BadRequestException('No pages uploaded');
    const widths = parseNumbers(body.widths);
    const heights = parseNumbers(body.heights);
    return this.summaries.create(
      tripId,
      user.sub,
      {
        title: (body.title ?? '').slice(0, 120) || 'Samenvatting',
        template: (body.template ?? 'route').slice(0, 40),
        scopeLabel: (body.scopeLabel ?? '').slice(0, 120),
        spec: parseSpec(body.spec),
      },
      files.map((file, i) => ({
        buffer: file.buffer,
        mimetype: file.mimetype,
        width: widths[i] ?? 1080,
        height: heights[i] ?? 1920,
      })),
    );
  }

  @Patch(':summaryId')
  rename(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('summaryId', ParseUUIDPipe) summaryId: string,
    @Body() dto: RenameSummaryDto,
  ): Promise<TripSummaryInfo> {
    return this.summaries.rename(tripId, user.sub, summaryId, dto.title);
  }

  @Delete(':summaryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('summaryId', ParseUUIDPipe) summaryId: string,
  ): Promise<void> {
    await this.summaries.remove(tripId, user.sub, summaryId);
  }

  @Get(':summaryId/pages/:index')
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  async page(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('summaryId', ParseUUIDPipe) summaryId: string,
    @Param('index') index: string,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const page = await this.summaries.page(tripId, user.sub, summaryId, Number(index) || 0);
    res.setHeader('Content-Type', page.mime);
    // A page never changes: it is a picture that was rendered once.
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.end(Buffer.from(page.buffer));
  }
}

function parseNumbers(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((n) => Number(n))
    .map((n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0));
}

/** A spec we cannot read is not worth refusing the whole poster over. */
function parseSpec(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}
