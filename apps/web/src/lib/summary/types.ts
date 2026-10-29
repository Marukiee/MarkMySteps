import type { MediaItem, RouteCollection, Trip } from '../../api/types';
import type { PlannedStop } from '../arc';
import type { Weather } from '../weather';
import { t } from '../../i18n';

/** The four layouts. A series is any of them repeated over several pages. */
export type TemplateId = 'route' | 'photos' | 'ribbon' | 'stats';

export const TEMPLATE_NAMES: Record<TemplateId, string> = {
  route: t('summary.template.route'),
  photos: t('summary.template.photos'),
  ribbon: t('summary.template.ribbon'),
  stats: t('summary.template.stats'),
};

export const TEMPLATE_HINTS: Record<TemplateId, string> = {
  route: t('summary.templateHint.route'),
  photos: t('summary.templateHint.photos'),
  ribbon: t('summary.templateHint.ribbon'),
  stats: t('summary.templateHint.stats'),
};

/** Two moods. Dark for a feed of photographs, light for the app's own paper. */
export type ThemeId = 'dark' | 'light';

export const THEME_NAMES: Record<ThemeId, string> = {
  dark: t('summary.theme.dark'),
  light: t('summary.theme.light'),
};

/**
 * What the line under the trip's name says.
 *
 * A whole trip has no single place: taking the middle of it and asking the
 * geocoder gave one arbitrary municipality nobody would name. So a trip says
 * which countries it was in, a day says where you were, and either can be
 * overruled by hand.
 */
export type SubtitleMode = 'auto' | 'countries' | 'stops' | 'place' | 'none';

export const SUBTITLE_NAMES: Record<SubtitleMode, string> = {
  auto: t('common.automatic'),
  countries: t('summary.subtitle.countries'),
  stops: t('summary.subtitle.stops'),
  place: t('summary.subtitle.place'),
  none: t('summary.subtitle.none'),
};

export type FormatId = 'story' | 'post' | 'square';

export const FORMATS: Record<FormatId, { label: string; width: number; height: number }> = {
  story: { label: t('summary.format.story'), width: 1080, height: 1920 },
  post: { label: t('summary.format.post'), width: 1080, height: 1350 },
  square: { label: t('summary.format.square'), width: 1080, height: 1080 },
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
  theme: ThemeId;
  subtitle: SubtitleMode;
  /** Typed by hand; anything here wins over the mode above. */
  subtitleText: string;
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

/** A route split the way a map draws it. All lines are [lng, lat]. */
export interface RouteShape {
  /** What was travelled over the ground and recorded. */
  ground: [number, number][][];
  /** Ground nobody recorded (a tunnel, a dead phone): dashed and straight. */
  gaps: [number, number][][];
  /** Flights, as arcs. */
  flights: [number, number][][];
  /** How far, flights counted as the distance between the airports. */
  km: number;
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
  /** The route of this page's period, already cut into ground and air. */
  route: RouteShape;
  /** Places you actually stayed, in travel order. */
  stops: {
    name: string;
    lng: number;
    lat: number;
    countryCode: string | null;
    /** The days you were there, for picking a photo that belongs to it. */
    from: string;
    to: string;
  }[];
  /** The route of the whole trip, so a series page can show its progress. */
  allRoute: RouteShape;
  photos: string[];
  /** The place under each photo, where the layout names them. */
  photoLabels: string[] | null;
  /** Other photographs from the period, to stand in for one that fails. */
  spare: string[];
  facts: Fact[];
  flags: string[];
  accent: string;
  /** "3 van 8", drawn small on a series page. */
  pageLabel: string | null;
}
