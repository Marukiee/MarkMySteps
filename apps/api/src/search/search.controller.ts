import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SearchResults, SearchService } from './search.service';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * One box over trips, places, notes and photographs.
   *
   * Rate-limited rather than debounced only on the client: a search that
   * reaches Immich costs someone else's server work too.
   */
  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  query(@CurrentUser() user: JwtPayload, @Query('q') q?: string): Promise<SearchResults> {
    return this.search.search(user.sub, q ?? '');
  }
}
