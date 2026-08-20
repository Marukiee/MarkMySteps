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
  query(
    @CurrentUser() user: JwtPayload,
    @Query('q') q?: string,
    @Query('person') person?: string | string[],
    @Query('country') country?: string | string[],
  ): Promise<SearchResults> {
    return this.search.search(user.sub, q ?? '', {
      personIds: asArray(person),
      countryCodes: asArray(country).map((code) => code.toUpperCase()),
    });
  }

  /** The faces and countries the filter panel offers. */
  @Get('facets')
  facets(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ people: { id: string; name: string }[]; countries: { code: string; name: string }[] }> {
    return this.search.facets(user.sub);
  }
}

/** A repeated query parameter arrives as a string, or as several. */
function asArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean).slice(0, 20);
}
