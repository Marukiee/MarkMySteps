import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { registerMapCache } from './mapCache';

/**
 * The one door MapLibre comes through.
 *
 * Everything that builds a map imports it from here instead of straight from
 * the package, for two reasons. The cache protocol has to be installed before
 * the first map is built, and doing it as this module loads makes that true by
 * construction — no ordering to remember at six different call sites. And it
 * keeps the megabyte of map code out of the app's first chunk: only the routes
 * that actually show a map pull this in, so a cold start on a slow phone no
 * longer downloads and parses a map engine it has nothing to do with yet.
 */
registerMapCache(maplibregl);

export * from 'maplibre-gl';
export default maplibregl;
