import { CSSProperties, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flagEmoji } from '../lib/colors';
import { CountryGlobe } from './CountryGlobe';
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
      <div className="stat-tile stat-tile-wide" style={{ animationDelay: '0ms' }}>
        <span className="stat-tile-icon" style={{ '--tone': '#4a8f3c' } as CSSProperties}>
          <Icon name="car" size={17} />
        </span>
        <strong>
          {stats ? (
            <CountUp value={stats.distanceKm} format={(v) => v.toLocaleString('nl-NL')} />
          ) : (
            <span className="stat-skeleton" />
          )}
        </strong>
        <small>kilometer afgelegd</small>
      </div>
      <div className="stat-tile" style={{ animationDelay: '60ms' }}>
        <span className="stat-tile-icon" style={{ '--tone': '#2f7fd4' } as CSSProperties}>
          <Icon name="globe" size={17} />
        </span>
        <strong>
          {stats ? <CountUp value={stats.countries.length} /> : <span className="stat-skeleton" />}
        </strong>
        <small>landen</small>
      </div>
      {TILES.map((tile, i) => (
        <div
          key={tile.key}
          className="stat-tile"
          style={{ animationDelay: `${120 + i * 60}ms` }}
        >
          <span className="stat-tile-icon" style={{ '--tone': tile.tone } as CSSProperties}>
            <Icon name={tile.icon} size={17} />
          </span>
          <strong>
            {stats ? <CountUp value={stats[tile.key]} /> : <span className="stat-skeleton" />}
          </strong>
          <small>{tile.label}</small>
        </div>
      ))}
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

/** The globe, with the flags beside it as the legend it needs. */
export function CountryPanel({ countries }: { countries: string[] }) {
  if (countries.length === 0) return null;
  return (
    <section className="country-panel">
      <CountryGlobe countries={countries} size={168} />
      <div className="country-panel-side">
        <h3>{plural(countries.length, 'land', 'landen')}</h3>
        <div className="country-row">
          {countries.map((code, i) => (
            <span key={code} className="country-flag" style={{ animationDelay: `${i * 35}ms` }}>
              {flagEmoji(code) || code}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The last few trips, as links. */
export function RecentTrips({ trips }: { trips: TravelStats['recent'] }) {
  if (trips.length === 0) return null;
  return (
    <section className="recent-trips">
      <h3>Laatste reizen</h3>
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
