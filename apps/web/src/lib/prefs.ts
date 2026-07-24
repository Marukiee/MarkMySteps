import type { StyleSpecification } from 'maplibre-gl';

/** Local display preferences (device-scoped, no server round-trip). */

export type MapStyleId = 'positron' | 'bright' | 'liberty' | 'satellite';

const MAP_STYLE_KEY = 'mms.mapstyle';

export const MAP_STYLES: { id: MapStyleId; label: string }[] = [
  { id: 'positron', label: 'Licht & minimaal' },
  { id: 'bright', label: 'Helder & kleurrijk' },
  { id: 'liberty', label: 'Klassiek' },
  { id: 'satellite', label: 'Satelliet' },
];

// Keyless satellite raster (Esri World Imagery). No Google, no API key.
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Imagery © Esri',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};

export function getMapStyleId(): MapStyleId {
  return (localStorage.getItem(MAP_STYLE_KEY) as MapStyleId | null) ?? 'positron';
}

export function setMapStyleId(id: MapStyleId): void {
  localStorage.setItem(MAP_STYLE_KEY, id);
}

/** Returns a MapLibre style: a URL for vector styles, or a spec for satellite. */
export function getMapStyle(): string | StyleSpecification {
  const id = getMapStyleId();
  if (id === 'satellite') return SATELLITE_STYLE;
  // In dark mode swap any light vector style for a dark one so the map (and the
  // status bar over it) stays readable.
  if (resolvedTheme() === 'dark') return 'https://tiles.openfreemap.org/styles/dark';
  return `https://tiles.openfreemap.org/styles/${id}`;
}

/* ---------- Theme (light / dark / follow system) ---------- */

export type ThemeId = 'system' | 'light' | 'dark';
const THEME_KEY = 'mms.theme';

export function getThemeId(): ThemeId {
  return (localStorage.getItem(THEME_KEY) as ThemeId | null) ?? 'system';
}

/** The effective theme after resolving "system". */
export function resolvedTheme(id: ThemeId = getThemeId()): 'light' | 'dark' {
  if (id === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return id;
}

/** Applies the theme to <html data-theme> and notifies listeners. */
export function applyTheme(id: ThemeId = getThemeId()): void {
  const theme = resolvedTheme(id);
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new CustomEvent('mms-theme', { detail: theme }));
}

export function setThemeId(id: ThemeId): void {
  localStorage.setItem(THEME_KEY, id);
  applyTheme(id);
}

/* ---------- Trip card size on the home page ---------- */

export type TripCardSize = 'large' | 'compact' | 'auto';
const CARD_SIZE_KEY = 'mms.cardsize';

export function getTripCardSize(): TripCardSize {
  return (localStorage.getItem(CARD_SIZE_KEY) as TripCardSize | null) ?? 'auto';
}

export function setTripCardSize(v: TripCardSize): void {
  localStorage.setItem(CARD_SIZE_KEY, v);
}
