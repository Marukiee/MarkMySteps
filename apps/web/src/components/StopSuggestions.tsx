import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { reversePlaceName, searchPlaces } from '../lib/geocode';
import { Flag } from './Flag';
import { Icon } from './Icon';
import './stopsuggestions.css';

export interface StaySuggestion {
  key: string;
  latitude: number;
  longitude: number;
  from: string;
  to: string;
  nights: number;
  photos: number;
}

interface NamedStay extends StaySuggestion {
  /** Reverse-geocoded, so a suggestion says "Split" and not a coordinate. */
  name: string | null;
  countryCode?: string;
}

const DISMISS_KEY = 'mms.stays.dismissed';

/**
 * Places the trip's own track says you slept, offered as stops.
 *
 * A trip that was tracked but never planned already contains its itinerary:
 * every night somewhere is hours of fixes that stayed put. Rather than making
 * you type those towns in from memory, they are offered back with the dates
 * they happened on, and adding one is a single press.
 */
export function StopSuggestions({
  tripId,
  onAdd,
}: {
  tripId: string;
  onAdd: (stay: StaySuggestion, name: string, countryCode?: string) => Promise<void>;
}) {
  const [stays, setStays] = useState<NamedStay[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const dismissed = readDismissed();

    api<StaySuggestion[]>(`/trips/${tripId}/stops/suggestions`)
      .then(async (found) => {
        const fresh = found.filter((s) => !dismissed.includes(s.key));
        if (!alive.current) return;
        setStays(fresh.map((s) => ({ ...s, name: null })));

        // Named one at a time: the geocoder is a public one, and a trip with
        // twenty stays should not fire twenty requests at it at once.
        for (const stay of fresh) {
          const name = await reversePlaceName(stay.latitude, stay.longitude).catch(() => null);
          if (!alive.current) return;
          const country = name ? await countryOf(name) : undefined;
          if (!alive.current) return;
          setStays((current) =>
            current.map((s) => (s.key === stay.key ? { ...s, name, countryCode: country } : s)),
          );
        }
      })
      .catch(() => undefined);

    return () => {
      alive.current = false;
    };
  }, [tripId]);

  function drop(key: string, after: () => void) {
    setLeaving((current) => [...current, key]);
    window.setTimeout(() => {
      setStays((current) => current.filter((s) => s.key !== key));
      setLeaving((current) => current.filter((k) => k !== key));
      after();
    }, 300);
  }

  async function accept(stay: NamedStay) {
    setBusy(stay.key);
    try {
      await onAdd(stay, stay.name ?? placeLabel(stay), stay.countryCode);
      drop(stay.key, () => undefined);
    } finally {
      setBusy(null);
    }
  }

  function dismiss(stay: NamedStay) {
    drop(stay.key, () => {
      const dismissed = readDismissed();
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed, stay.key].slice(-400)));
    });
  }

  if (stays.length === 0) return null;

  return (
    <section className={`stay-suggest ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="stay-suggest-head"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="stay-suggest-spark">
          <Icon name="sparkle" size={15} />
        </span>
        <span className="stay-suggest-title">
          <strong>Gevonden in je route</strong>
          <small>
            {stays.length} {stays.length === 1 ? 'plek' : 'plekken'} waar je bleef slapen
          </small>
        </span>
        <Icon name="chevron-down" size={16} className="stay-suggest-caret" />
      </button>

      {!collapsed && (
        <div className="stay-suggest-list">
          {stays.map((stay, index) => (
            <article
              key={stay.key}
              className={`stay-card ${leaving.includes(stay.key) ? 'leaving' : ''}`}
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
            >
              <div className="stay-card-body">
                <span className="stay-card-name">
                  {stay.countryCode && <Flag code={stay.countryCode} size={16} />}
                  {stay.name ?? <span className="stay-card-ghost">{placeLabel(stay)}</span>}
                </span>
                <span className="stay-card-meta">
                  {dateRange(stay.from, stay.to)}
                  <span className="stay-card-dot">·</span>
                  {stay.nights} {stay.nights === 1 ? 'nacht' : 'nachten'}
                  {stay.photos > 0 && (
                    <>
                      <span className="stay-card-dot">·</span>
                      <Icon name="camera" size={12} /> {stay.photos}
                    </>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="stay-card-add"
                disabled={busy === stay.key}
                onClick={() => void accept(stay)}
              >
                <Icon name="plus" size={15} />
                Toevoegen
              </button>
              <button
                type="button"
                className="stay-card-no"
                aria-label="Niet deze"
                onClick={() => dismiss(stay)}
              >
                <Icon name="close" size={15} />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** "12 – 14 aug", or one date when the stay began and ended on the same day. */
function dateRange(from: string, to: string): string {
  const start = new Date(from);
  const end = new Date(to);
  const day = (d: Date, withMonth: boolean) =>
    d.toLocaleDateString('nl-NL', {
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
    });
  const sameMonth = start.getMonth() === end.getMonth();
  if (start.toDateString() === end.toDateString()) return day(start, true);
  return `${day(start, !sameMonth)} – ${day(end, true)}`;
}

function placeLabel(stay: StaySuggestion): string {
  return `${stay.latitude.toFixed(3)}, ${stay.longitude.toFixed(3)}`;
}

/**
 * The country the geocoded name belongs to, for the flag.
 *
 * The reverse lookup gives "Split, Croatia" but no country code, so the name
 * is run back through the forward search, which does return one. Cheap enough:
 * it is one request per suggestion, and only once.
 */
async function countryOf(name: string): Promise<string | undefined> {
  const [first] = await searchPlaces(name).catch(() => []);
  return first?.countryCode;
}

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
