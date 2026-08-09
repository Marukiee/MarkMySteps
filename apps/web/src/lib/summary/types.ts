import type { MediaItem, RouteCollection, Trip } from '../../api/types';
import type { PlannedStop } from '../arc';
import type { Weather } from '../weather';

/** The four layouts. A series is any of them repeated over several pages. */
export type TemplateId = 'route' | 'photos' | 'ribbon' | 'stats';

export const TEMPLATE_NAMES: Record<TemplateId, string> = {
  route: 'Routekaart',
  photos: 'Fotodag',
  ribbon: 'Stoppenlint',
  stats: 'Cijferposter',
};

export const TEMPLATE_HINTS: Record<TemplateId, string> = {
  route: 'De kaart is de hoofdpersoon. Voor een hike of een dag onderweg.',
  photos: 'Alleen foto’s, plaatsnaam, datum en het weer. Voor een dag in de stad.',
  ribbon: 'De hele route met genummerde stops en een foto per stop.',
  stats: 'Eén grote foto met de cijfers van de reis eroverheen.',
};

export type FormatId = 'story' | 'post' | 'square';

export const FORMATS: Record<FormatId, { label: string; width: number; height: number }> = {
  story: { label: 'Verhaal 9:16', width: 1080, height: 1920 },
  post: { label: 'Bericht 4:5', width: 1080, height: 1350 },
  square: { label: 'Vierkant 1:1', width: 1080, height: 1080 },
};

/** Which slice of the trip a summary is about. Dates are yyyy-mm-dd. */
export interface Scope {
  kind: 'trip' | 'day' | 'range';
  from: string;
  to: string;
}

/**
 * The recipe. Stored next to the rendered pages so a summary can be opened
 * again later and remade with one setting changed, instead of every question
 * being asked from scratch.
 */
export interface SummarySpec {
  template: TemplateId;
  format: FormatId;
  scope: Scope;
  /** One page, or one page per day of the scope. */
  series: boolean;
  showLogo: boolean;
  showWeather: boolean;
  /** Manually picked photos; empty means "choose them for me". */
  photoIds: string[];
}

/** Everything the trip page already knows, handed to the renderer as one lump. */
export interface SummarySource {
  trip: Trip;
  stops: PlannedStop[];
  media: MediaItem[];
  routes: RouteCollection | null;
}

/** One number on a poster. */
export interface Fact {
  value: string;
  label: string;
}

/** A single page, resolved down to exactly what gets drawn. */
export interface PageData {
  title: string;
  dateLabel: string;
  place: string | null;
  weather: Weather | null;
  /** Route lines in [lng, lat], already limited to this page's period. */
  lines: [number, number][][];
  /** Stops in this period, in travel order. */
  stops: { name: string; lng: number; lat: number; countryCode: string | null; number: number }[];
  /** Every stop of the whole trip, so a series page can show its progress. */
  allLines: [number, number][][];
  photos: string[];
  facts: Fact[];
  flags: string[];
  accent: string;
  /** "3 van 8", drawn small on a series page. */
  pageLabel: string | null;
}
