import { CSSProperties, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CountryGlobe } from './CountryGlobe';
import { Flag } from './Flag';
import { Icon, IconName } from './Icon';
import './travelstats.css';

/** What `/users/:id/stats` answers. */
export interface TravelStats {
  user: {
    id: string;
    username: string;
    displayName: string;
    hasAvatar: boolean;
  };
  sharedTrips: number;
  trips: number;
  ongoing: number;
  days: number;
  countries: string[];
  places: number;
  flights: number;
  distanceKm: number;
  photoCount: number;
  recent: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    color: string | null;
  }[];
}

/** "1 reis" / "4 reizen", instead of the "reiszen" a bare suffix produced. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const TILES: {
  key: 'trips' | 'days' | 'places' | 'flights' | 'photoCount';
  label: string;
  icon: IconName;
  /** Tile accent, so the block reads as a set of things rather than a table. */
  tone: string;
}[] = [
  { key: 'trips', label: 'reizen', icon: 'compass', tone: '#e8613c' },
  { key: 'days', label: 'dagen op reis', icon: 'hourglass', tone: '#c98a2d' },
  { key: 'places', label: 'plaatsen', icon: 'pin', tone: '#2a8f85' },
  { key: 'flights', label: 'vluchten', icon: 'plane', tone: '#5b6ee1' },
  { key: 'photoCount', label: "foto's", icon: 'camera', tone: '#b04a98' },
];

/**
 * The numbers.
 *
 * Each tile counts up on arrival rather than appearing at its final value: a
 * number that lands reads as something you did, one that was simply there
 * reads as a label. Distance gets a double-width tile because it is the one
 * with four or five digits, and it looked cramped beside the small ones.
 */
export function StatGrid({ stats }: { stats: TravelStats | null }) {
  return (
    <div className="stat-grid">
      <Tile
        wide
        icon="distance"
        tone="#4a8f3c"
        label="kilometer afgelegd"
        delay={0}
        value={stats?.distanceKm}
        format={(v) => v.toLocaleString('nl-NL')}
      />
      <Tile
        icon="globe"
        tone="#2f7fd4"
        label="landen"
        delay={60}
        value={stats?.countries.length}
      />
      {TILES.map((tile, i) => (
        <Tile
          key={tile.key}
          icon={tile.icon}
          tone={tile.tone}
          label={tile.label}
          delay={120 + i * 60}
          value={stats?.[tile.key]}
        />
      ))}
    </div>
  );
}

/**
 * Number and label down the left, icon in the top right corner.
 *
 * The corner is where it stays out of the way of the two things you read; the
 * size is what stops it looking like an afterthought there.
 */
function Tile({
  icon,
  tone,
  label,
  value,
  delay,
  wide,
  format,
}: {
  icon: IconName;
  tone: string;
  label: string;
  value: number | undefined;
  delay: number;
  wide?: boolean;
  format?: (v: number) => string;
}) {
  return (
    <div
      className={`stat-tile ${wide ? 'stat-tile-wide' : ''}`}
      style={{ '--tone': tone, animationDelay: `${delay}ms` } as CSSProperties}
    >
      <strong>
        {value === undefined ? (
          <span className="stat-skeleton" />
        ) : (
          <CountUp value={value} format={format} />
        )}
      </strong>
      <Icon name={icon} size={wide ? 30 : 26} className="stat-tile-icon" />
      <small>{label}</small>
    </div>
  );
}

/** Counts from zero to `value`, eased out. */
export function CountUp({ value, format }: { value: number; format?: (v: number) => string }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (value <= 0) {
      setShown(0);
      return;
    }
    const DURATION = 900;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      // Ease-out cubic: quick at first, settling onto the real number.
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format ? format(shown) : shown}</>;
}

/** Dutch country names, for the legend beside the globe. */
const COUNTRY_NAMES = new Intl.DisplayNames(['nl'], { type: 'region' });

function countryName(code: string): string {
  try {
    return COUNTRY_NAMES.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/**
 * The globe, with every country named underneath it.
 *
 * Under rather than beside: at a dozen countries the names wrap into a column
 * so narrow that half of them break in two. The count is not repeated here —
 * it is already one of the tiles above.
 */
export function CountryPanel({ countries }: { countries: string[] | null }) {
  if (countries !== null && countries.length === 0) return null;
  const sorted = [...(countries ?? [])].sort((a, b) =>
    countryName(a).localeCompare(countryName(b), 'nl'),
  );
  return (
    <section className="country-panel">
      {/* The globe's box is there from the first frame, holding its own size,
          with the sea already in it. The panel used to grow the moment the
          numbers arrived, which shoved everything under it down the page —
          and the globe itself popped in on top of that. */}
      <div className="country-globe-slot">
        <span className="country-globe-skeleton" data-done={countries !== null} aria-hidden="true" />
        {countries !== null && <CountryGlobe countries={countries} size={190} />}
      </div>
      <div className="country-row">
        {sorted.map((code, i) => (
          <span key={code} className="country-chip" style={{ animationDelay: `${i * 35}ms` }}>
            <Flag code={code} size={13} />
            {countryName(code)}
          </span>
        ))}
      </div>
    </section>
  );
}

/** The last few trips, as links. */
export function RecentTrips({
  trips,
  who,
}: {
  trips: TravelStats['recent'];
  /** Whose trips these are. Left out on your own page: "Je laatste reizen". */
  who?: string;
}) {
  if (trips.length === 0) return null;
  return (
    <section className="recent-trips">
      <h3>{who ? `Laatste reizen van ${who}` : 'Je laatste reizen'}</h3>
      <ul>
        {trips.map((trip, i) => (
          <li key={trip.id} style={{ animationDelay: `${i * 55}ms` }}>
            <Link to={`/trips/${trip.id}`}>
              <span className="recent-dot" style={{ background: trip.color ?? 'var(--accent)' }} />
              <span className="recent-name">
                <strong>{trip.title}</strong>
                <small>
                  {new Date(trip.startDate).toLocaleDateString('nl-NL', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </small>
              </span>
              <Icon name="chevron-right" size={16} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
