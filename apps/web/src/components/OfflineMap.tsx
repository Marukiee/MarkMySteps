import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { RouteCollection } from '../api/types';
import type { PlannedStop } from '../lib/arc';
import {
  clearRegion,
  regionFor,
  saveRegion,
  tileCount,
  zoomThatFits,
  type RegionInfo,
} from '../lib/mapCache';
import { rawMapStyle } from '../lib/prefs';
import { Icon } from './Icon';
import './offlinemap.css';

/**
 * Keeps this trip's part of the map on the phone.
 *
 * The target phones are de-Googled and usually abroad on no data at all, which
 * is where a map earns its keep. Saved per trip, because that is the size of
 * the answer: the box around where you actually went, not the planet.
 */
export function OfflineMap({ tripId }: { tripId: string }) {
  const [region, setRegion] = useState<RegionInfo | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RouteCollection | null>(null);
  const [stops, setStops] = useState<PlannedStop[]>([]);

  useEffect(() => {
    void regionFor(tripId).then(setRegion);
    // The area to save is wherever this trip has been: its line and its stops.
    api<RouteCollection>(`/trips/${tripId}/route`).then(setRoutes).catch(() => undefined);
    api<PlannedStop[]>(`/trips/${tripId}/stops`).then(setStops).catch(() => undefined);
  }, [tripId]);

  const bbox = boundsOf(routes, stops);
  const zoom = bbox ? zoomThatFits(bbox) : 0;
  const tiles = bbox
    ? Array.from({ length: zoom + 1 }, (_, z) => tileCount(bbox, z)).reduce((a, b) => a + b, 0)
    : 0;

  async function download() {
    if (!bbox) return;
    setError(null);
    setProgress({ done: 0, total: tiles });
    try {
      const style = rawMapStyle();
      if (typeof style !== 'string') {
        setError('Satellietkaart kan niet offline bewaard worden. Kies een andere kaartstijl.');
        setProgress(null);
        return;
      }
      const saved = await saveRegion(tripId, bbox, style, (p) =>
        setProgress({ done: p.done, total: p.total }),
      );
      setRegion(saved);
    } catch {
      setError('Downloaden mislukt');
    } finally {
      setProgress(null);
    }
  }

  async function remove() {
    await clearRegion(tripId);
    setRegion(null);
  }

  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <section className="ts-sync ts-sync-stacked offline-map">
      <div>
        <strong>Kaart offline bewaren</strong>
        <span className="muted">
          {region
            ? `${megabytes(region.bytes)} bewaard, tot zoomniveau ${region.zoom}. De kaart van deze reis werkt nu zonder verbinding.`
            : bbox
              ? `Het gebied van deze reis, ongeveer ${tiles.toLocaleString('nl-NL')} tegels tot zoomniveau ${zoom}.`
              : 'Zodra deze reis een route of stops met een locatie heeft, kan het gebied bewaard worden.'}
        </span>
      </div>

      {progress ? (
        <div className="offline-map-progress" role="progressbar" aria-valuenow={Math.round(percent)}>
          <div className="offline-map-bar" style={{ width: `${percent}%` }} />
          <span className="offline-map-count">
            {progress.done} / {progress.total}
          </span>
        </div>
      ) : (
        <div className="offline-map-actions">
          {region && (
            <button className="btn btn-ghost offline-map-clear" onClick={() => void remove()}>
              <Icon name="trash" size={15} /> Wissen
            </button>
          )}
          <button className="btn btn-ghost" disabled={!bbox} onClick={() => void download()}>
            <Icon name="download" size={15} /> {region ? 'Opnieuw ophalen' : 'Downloaden'}
          </button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

/** The box around everything this trip knows about, with a little air. */
function boundsOf(
  routes: RouteCollection | null,
  stops: PlannedStop[],
): [number, number, number, number] | null {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  let any = false;

  const add = (lng: number, lat: number) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    any = true;
  };

  for (const feature of routes?.features ?? []) {
    for (const [lng, lat] of feature.geometry.coordinates as [number, number][]) add(lng, lat);
  }
  for (const stop of stops) {
    if (stop.latitude !== null && stop.longitude !== null) add(stop.longitude, stop.latitude);
  }
  if (!any) return null;

  // A quarter of a degree of margin: enough that panning off the route does
  // not immediately run into grey.
  const pad = 0.25;
  return [
    Math.max(-180, west - pad),
    Math.max(-85, south - pad),
    Math.min(180, east + pad),
    Math.min(85, north + pad),
  ];
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
