import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImmichClientService } from '../immich/immich-client.service';
import { ImmichConnectionService } from '../immich/immich-connection.service';

export interface SearchResults {
  /** What the words were taken to mean, so the UI can say so. */
  interpretation: {
    people: { id: string; name: string }[];
    places: string[];
    text: string | null;
  };
  trips: { id: string; title: string; startDate: string; endDate: string }[];
  stops: {
    id: string;
    tripId: string;
    tripTitle: string;
    name: string;
    countryCode: string | null;
  }[];
  notes: { tripId: string; tripTitle: string; day: string; snippet: string }[];
  photos: {
    id: string;
    tripId: string;
    tripTitle: string;
    takenAt: string;
    assetType: string;
  }[];
}

const PHOTO_LIMIT = 60;
const ROW_LIMIT = 8;
/** How long a user's Immich people list is reused. Names change rarely. */
const PEOPLE_TTL_MS = 10 * 60_000;
/** Around a matched place, in degrees (~55 km) — a town, not a country. */
const PLACE_BOX_DEG = 0.5;

interface CachedPeople {
  at: number;
  people: { id: string; name: string }[];
}

/**
 * One search box over everything: trips, places, notes, and the photographs
 * themselves.
 *
 * The photo half leans on Immich, which has already looked at every picture:
 * it knows what is in them and whose faces are in them. So "Zweden Thijs" is
 * answered by asking Immich for Thijs's photos and keeping the ones this app
 * knows were taken in Sweden - rather than by scanning anything here.
 *
 * Everything is filtered back through trip membership on our side, so a search
 * can never surface a photo from a trip the caller is not on.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly peopleCache = new Map<string, CachedPeople>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly immich: ImmichClientService,
    private readonly connections: ImmichConnectionService,
  ) {}

  /**
   * What there is to filter by: faces Immich knows, and the countries this
   * account has actually been to.
   */
  async facets(userId: string): Promise<{
    people: { id: string; name: string }[];
    countries: { code: string; name: string }[];
  }> {
    const [people, visited] = await Promise.all([
      this.peopleOf(userId),
      this.prisma.stop.findMany({
        where: { trip: { members: { some: { userId } } }, countryCode: { not: null } },
        select: { countryCode: true },
        distinct: ['countryCode'],
      }),
    ]);

    const countries = visited
      .map(({ countryCode }) => ({
        code: countryCode!,
        name: countryNames(countryCode!)[0] ?? countryCode!,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

    return {
      people: [...people].sort((a, b) => a.name.localeCompare(b.name, 'nl')).slice(0, 60),
      countries,
    };
  }

  async search(
    userId: string,
    query: string,
    picked: { personIds?: string[]; countryCodes?: string[] } = {},
  ): Promise<SearchResults> {
    const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    const pickedPeople = picked.personIds ?? [];
    const pickedCountries = picked.countryCodes ?? [];
    const empty: SearchResults = {
      interpretation: { people: [], places: [], text: null },
      trips: [],
      stops: [],
      notes: [],
      photos: [],
    };
    if (terms.length === 0 && pickedPeople.length === 0 && pickedCountries.length === 0) {
      return empty;
    }

    // The trips this account may see at all. Everything below is scoped to
    // these ids, which is both the permission check and the cheapest filter.
    const memberships = await this.prisma.tripMember.findMany({
      where: { userId },
      select: { tripId: true, trip: { select: { title: true } } },
    });
    const tripIds = memberships.map((m) => m.tripId);
    if (tripIds.length === 0) return empty;
    const titleOf = new Map(memberships.map((m) => [m.tripId, m.trip.title]));

    // Ticked in the filter panel, or recognised in the words — both end up as
    // the same face filter.
    const named = await this.matchPeople(userId, terms);
    const people = [...named];
    if (pickedPeople.length > 0) {
      const known = await this.peopleOf(userId);
      for (const id of pickedPeople) {
        if (people.some((p) => p.id === id)) continue;
        const person = known.find((p) => p.id === id);
        if (person) people.push({ id: person.id, name: person.name, term: '' });
      }
    }
    const usedByPeople = new Set(named.map((p) => p.term));
    const placeTerms = terms.filter((t) => !usedByPeople.has(t));

    const [trips, stops, notes] = await Promise.all([
      this.prisma.trip.findMany({
        where: {
          id: { in: tripIds },
          OR: terms.flatMap((term) => [
            { title: { contains: term, mode: 'insensitive' as const } },
            { description: { contains: term, mode: 'insensitive' as const } },
          ]),
        },
        select: { id: true, title: true, startDate: true, endDate: true },
        orderBy: { startDate: 'desc' },
        take: ROW_LIMIT,
      }),
      this.prisma.stop.findMany({
        where: {
          tripId: { in: tripIds },
          OR: placeTerms.map((term) => ({
            name: { contains: term, mode: 'insensitive' as const },
          })),
        },
        select: {
          id: true,
          tripId: true,
          name: true,
          countryCode: true,
          latitude: true,
          longitude: true,
        },
        take: ROW_LIMIT * 2,
      }),
      this.prisma.tripNote.findMany({
        where: {
          tripId: { in: tripIds },
          OR: terms.map((term) => ({ body: { contains: term, mode: 'insensitive' as const } })),
        },
        select: { tripId: true, day: true, body: true },
        orderBy: { day: 'desc' },
        take: ROW_LIMIT,
      }),
    ]);

    // Countries are named in the search box the way people speak ("Zweden"),
    // while a stop only carries "SE" — so the codes this account has actually
    // been to are turned into names and matched against the words.
    const countryStops = await this.stopsInCountries(tripIds, placeTerms, pickedCountries);

    // A term that named a place is a filter on the photos, not a search word
    // to hand to Immich: "Zweden" is where, not what.
    const matchedPlaceTerms = new Set([
      ...placeTerms.filter((term) =>
        stops.some((stop) => stop.name.toLowerCase().includes(term.toLowerCase())),
      ),
      ...countryStops.terms,
    ]);
    const placeStops = [...stops, ...countryStops.stops];
    const freeText = terms
      .filter((term) => !usedByPeople.has(term) && !matchedPlaceTerms.has(term))
      .join(' ');

    const photos = await this.findPhotos(userId, tripIds, {
      personIds: people.map((p) => p.id),
      places: matchedPlaceTerms.size > 0 ? placeStops.filter((s) => s.latitude !== null) : [],
      text: freeText || null,
    });

    return {
      interpretation: {
        people: people.map((p) => ({ id: p.id, name: p.name })),
        places: [...matchedPlaceTerms],
        text: freeText || null,
      },
      trips: trips.map((t) => ({
        id: t.id,
        title: t.title,
        startDate: t.startDate.toISOString().slice(0, 10),
        endDate: t.endDate.toISOString().slice(0, 10),
      })),
      stops: stops.slice(0, ROW_LIMIT).map((s) => ({
        id: s.id,
        tripId: s.tripId,
        tripTitle: titleOf.get(s.tripId) ?? '',
        name: s.name,
        countryCode: s.countryCode,
      })),
      notes: notes.map((n) => ({
        tripId: n.tripId,
        tripTitle: titleOf.get(n.tripId) ?? '',
        day: n.day.toISOString().slice(0, 10),
        snippet: snippet(n.body, terms),
      })),
      photos: photos.map((p) => ({
        id: p.id,
        tripId: p.tripId,
        tripTitle: titleOf.get(p.tripId) ?? '',
        takenAt: p.takenAt.toISOString(),
        assetType: p.assetType,
      })),
    };
  }

  /**
   * Stops in a country the words named.
   *
   * Only the codes this account has actually visited are considered, so the
   * comparison is over a handful of names rather than the world's.
   */
  private async stopsInCountries(
    tripIds: string[],
    terms: string[],
    picked: string[] = [],
  ): Promise<{
    terms: string[];
    stops: { latitude: number | null; longitude: number | null }[];
  }> {
    if (terms.length === 0 && picked.length === 0) return { terms: [], stops: [] };
    const visited = await this.prisma.stop.findMany({
      where: { tripId: { in: tripIds }, countryCode: { not: null } },
      select: { countryCode: true },
      distinct: ['countryCode'],
    });
    if (visited.length === 0) return { terms: [], stops: [] };

    const matchedCodes: string[] = [...picked];
    const matchedTerms: string[] = picked.map((code) => countryNames(code)[0] ?? code);
    for (const { countryCode } of visited) {
      const code = countryCode!;
      if (matchedCodes.includes(code)) continue;
      const names = countryNames(code);
      const term = terms.find((t) => names.includes(t.toLowerCase()) || t.toUpperCase() === code);
      if (term) {
        matchedCodes.push(code);
        matchedTerms.push(term);
      }
    }
    if (matchedCodes.length === 0) return { terms: [], stops: [] };

    const stops = await this.prisma.stop.findMany({
      where: { tripId: { in: tripIds }, countryCode: { in: matchedCodes } },
      select: { latitude: true, longitude: true },
    });
    return { terms: matchedTerms, stops };
  }

  /**
   * Photographs, found by whatever the words gave us.
   *
   * Faces and free text are questions only Immich can answer; place is one
   * only we can, because Immich does not know which trip a coordinate belongs
   * to. When Immich is asked, its answer is intersected with our own media
   * refs, which is where the permission check lives.
   */
  private async findPhotos(
    userId: string,
    tripIds: string[],
    filters: {
      personIds: string[];
      places: { latitude: number | null; longitude: number | null }[];
      text: string | null;
    },
  ) {
    const geo = filters.places.length > 0 ? boxAround(filters.places) : null;
    const askImmich = filters.personIds.length > 0 || filters.text !== null;

    let assetIds: string[] | null = null;
    if (askImmich) {
      const credentials = await this.connections.getCredentials(userId);
      if (credentials) {
        try {
          assetIds = await this.immich.searchAssetIds(credentials.serverUrl, credentials.apiKey, {
            query: filters.text ?? undefined,
            personIds: filters.personIds,
          });
        } catch (err) {
          this.logger.warn(`Immich search failed for user ${userId}: ${String(err)}`);
          assetIds = [];
        }
      } else {
        assetIds = [];
      }
    }

    // Nothing to go on but a place: show what was photographed there.
    if (assetIds === null && !geo) return [];

    return this.prisma.mediaRef.findMany({
      where: {
        tripId: { in: tripIds },
        ...(assetIds !== null ? { immichAssetId: { in: assetIds } } : {}),
        ...(geo
          ? {
              latitude: { gte: geo.south, lte: geo.north },
              longitude: { gte: geo.west, lte: geo.east },
            }
          : {}),
      },
      select: { id: true, tripId: true, takenAt: true, assetType: true },
      orderBy: { takenAt: 'desc' },
      take: PHOTO_LIMIT,
    });
  }

  /**
   * Terms that name somebody Immich has a face for.
   *
   * The list is small and changes rarely, so it is fetched once every ten
   * minutes per account rather than on every keystroke.
   */
  private async peopleOf(userId: string): Promise<{ id: string; name: string }[]> {
    const cached = this.peopleCache.get(userId);
    if (cached && Date.now() - cached.at < PEOPLE_TTL_MS) return cached.people;

    const credentials = await this.connections.getCredentials(userId);
    if (!credentials) return [];
    let people: { id: string; name: string }[];
    try {
      people = await this.immich.listPeople(credentials.serverUrl, credentials.apiKey);
    } catch (err) {
      this.logger.warn(`Could not list Immich people for user ${userId}: ${String(err)}`);
      people = [];
    }
    this.peopleCache.set(userId, { at: Date.now(), people });
    return people;
  }

  private async matchPeople(
    userId: string,
    terms: string[],
  ): Promise<{ id: string; name: string; term: string }[]> {
    if (terms.length === 0) return [];
    const people = await this.peopleOf(userId);

    const matches: { id: string; name: string; term: string }[] = [];
    for (const term of terms) {
      const lower = term.toLowerCase();
      // First names win: people are searched for as "Thijs", not "Thijs de Vries".
      const hit =
        people.find((p) => p.name.toLowerCase() === lower) ??
        people.find((p) => p.name.toLowerCase().split(/\s+/).includes(lower));
      if (hit && !matches.some((m) => m.id === hit.id)) {
        matches.push({ id: hit.id, name: hit.name, term });
      }
    }
    return matches;
  }
}

/** What a country code is called, in Dutch and in English, lowercased. */
const NAMES_NL = displayNames('nl');
const NAMES_EN = displayNames('en');

function displayNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    return null;
  }
}

function countryNames(code: string): string[] {
  const out: string[] = [];
  for (const names of [NAMES_NL, NAMES_EN]) {
    try {
      const name = names?.of(code);
      if (name) out.push(name.toLowerCase());
    } catch {
      /* an unknown region code is simply not a name */
    }
  }
  return out;
}

/** A box around every matched place, so "Zweden" is where those stops are. */
function boxAround(places: { latitude: number | null; longitude: number | null }[]) {
  const lats = places.map((p) => p.latitude).filter((v): v is number => v !== null);
  const lngs = places.map((p) => p.longitude).filter((v): v is number => v !== null);
  if (lats.length === 0 || lngs.length === 0) return null;
  return {
    south: Math.min(...lats) - PLACE_BOX_DEG,
    north: Math.max(...lats) + PLACE_BOX_DEG,
    west: Math.min(...lngs) - PLACE_BOX_DEG,
    east: Math.max(...lngs) + PLACE_BOX_DEG,
  };
}

/** The line of a note the search words are actually on. */
function snippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase());
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  const start = Math.max(0, at - 40);
  const text = body.slice(start, start + 160).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${start + 160 < body.length ? '…' : ''}`;
}
