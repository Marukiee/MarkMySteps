import { CSSProperties, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getLang, intlLocale, t } from '../i18n';
import { airportByCode } from '../lib/airports';
import { haversineKm } from '../lib/arc';
import { popWasOurs, skipNextPop } from '../lib/backStack';
import { formatDateRange } from '../lib/colors';
import { coverPage } from '../lib/cover';
import { useSheetDismiss } from '../lib/useSheetDismiss';
import { Flag } from './Flag';
import { Icon } from './Icon';
import type { FlightEnd, StatsListKind, TravelLists, TravelVisit } from './TravelStatsView';
import './statslist.css';

const COUNTRY_NAMES = new Intl.DisplayNames([getLang()], { type: 'region' });

function countryName(code: string): string {
  try {
    return COUNTRY_NAMES.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** A flight's end as you would say it: the place, else the airport's city. */
function endName(end: FlightEnd): string {
  return end.name ?? airportByCode(end.airport)?.city ?? end.airport ?? '?';
}

function endCountry(end: FlightEnd): string | null {
  return end.countryCode ?? airportByCode(end.airport)?.country ?? null;
}

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(intlLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "13 sep 2026" for a day trip, rather than "13 t/m 13 sep 2026". */
function stretchLabel(from: string, to: string): string {
  return from === to ? dayLabel(from) : formatDateRange(from, to);
}

/**
 * What is behind one of the numbers on a traveller's page: every place,
 * country, flight or trip, each with the way into the trip it belongs to.
 *
 * "Ga naar reis" opens that trip at the photos of the place itself, the way a
 * tile on the trip's own row of places does, not at the top of a timeline
 * three months long.
 */
export function StatsListSheet({
  kind,
  lists,
  onClose,
}: {
  kind: StatsListKind;
  lists: TravelLists;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const navigate = useNavigate();
  const sheet = useSheetDismiss(() => close());

  // The page under it stands still while it is covered.
  useEffect(() => coverPage(), []);

  function close() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 240);
  }

  // The back gesture closes the list rather than leaving the page under it.
  useEffect(() => {
    if (closing) return;
    window.history.pushState({ mmsStatsList: true }, '');
    let popped = false;
    const onPop = () => {
      if (popWasOurs()) return;
      popped = true;
      close();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) {
        skipNextPop();
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  /** Into the trip, after the list has stepped its own history entry back. */
  function go(tripId: string, stopId?: string) {
    close();
    window.setTimeout(() => navigate(`/trips/${tripId}${stopId ? `?stop=${stopId}` : ''}`), 120);
  }

  const flightNames = kind === 'flights' ? flightPlaceNames(lists.flights) : null;
  const airKm = kind === 'flights' ? kmInTheAir(lists.flights) : null;

  const count = {
    places: lists.places.length,
    countries: lists.countries.length,
    flights: lists.flights.length,
    trips: lists.trips.length,
  }[kind];
  const title = t(`trips.statsList.${kind}`, { count });

  return createPortal(
    <div className={`stats-list-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <div
        className="stats-list card"
        ref={sheet.ref}
        onClick={(e) => e.stopPropagation()}
        {...sheet.handlers}
      >
        <div className="stats-list-head">
          <span className="stats-list-grab" aria-hidden="true" />
          <div className="stats-list-title">
            <h2>{title}</h2>
            {airKm !== null && (
              <small>{t('trips.statsList.flightKm', { km: airKm.toLocaleString(intlLocale()) })}</small>
            )}
          </div>
          <button type="button" className="stats-list-close" aria-label={t('common.close')} onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <ul className="stats-list-rows">
          {kind === 'places' &&
            lists.places.map((place, i) => (
              <Row key={`${place.countryCode}/${place.name}`} i={i}>
                <div className="stats-list-top">
                  {place.countryCode && <Flag code={place.countryCode} size={14} />}
                  <strong>{place.name}</strong>
                  {place.countryCode && <small>{countryName(place.countryCode)}</small>}
                </div>
                <Visits visits={place.visits} onGo={go} />
              </Row>
            ))}

          {kind === 'countries' &&
            lists.countries.map((country, i) => (
              <Row key={country.code} i={i}>
                <div className="stats-list-top">
                  <Flag code={country.code} size={14} />
                  <strong>{countryName(country.code)}</strong>
                </div>
                <Visits visits={country.visits} onGo={go} />
              </Row>
            ))}

          {kind === 'flights' &&
            flightsByTrip(lists.flights).map((trip, i) => (
              <Row key={trip.tripId} i={i} className="flight-trip">
                <div className="stats-list-visit">
                  <span className="stats-list-what">
                    <strong>{trip.tripTitle}</strong>
                    <small>{stretchLabel(trip.flights[0]!.day, trip.flights[trip.flights.length - 1]!.day)}</small>
                  </span>
                  <GoButton onClick={() => go(trip.tripId)} />
                </div>
                {trip.flights.map((flight) => (
                  <FlightTicket
                    key={`${flight.stopId}/${flight.day}`}
                    flight={flight}
                    names={flightNames!}
                    still={i > 6}
                    onClick={() => go(trip.tripId, flight.stopId)}
                  />
                ))}
              </Row>
            ))}

          {kind === 'trips' &&
            lists.trips.map((trip, i) => (
              <Row key={trip.id} i={i}>
                <div className="stats-list-visit">
                  <span className="stats-list-dot" style={{ background: trip.color ?? 'var(--accent)' }} />
                  <span className="stats-list-what">
                    <strong>{trip.title}</strong>
                    <small>{stretchLabel(trip.from, trip.to)}</small>
                    <small>
                      {[
                        t('trips.statsList.days', { count: trip.days }),
                        t('trips.statsList.km', { km: trip.km.toLocaleString(intlLocale()) }),
                        t('trips.statsList.photos', { count: trip.photos }),
                      ].join(' · ')}
                    </small>
                  </span>
                  <GoButton onClick={() => go(trip.id)} />
                </div>
              </Row>
            ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

function Row({ i, className, children }: { i: number; className?: string; children: React.ReactNode }) {
  // Only the first screenful steps in one after another; the rest is out of
  // sight at that moment, and animating it would only cost the scroll frames.
  return (
    <li
      className={['stats-list-row', i <= 12 && 'stats-list-row-in', className].filter(Boolean).join(' ')}
      style={{ '--i': i } as CSSProperties}
    >
      {children}
    </li>
  );
}

/** Each time somebody was there: which trip, which days, and the way in. */
function Visits({
  visits,
  onGo,
}: {
  visits: (TravelVisit & { places?: string[] })[];
  onGo: (tripId: string, stopId: string) => void;
}) {
  return (
    <>
      {visits.map((visit) => (
        <div key={visit.tripId} className="stats-list-visit">
          <span className="stats-list-what">
            <span>{visit.tripTitle}</span>
            <small>
              {[stretchLabel(visit.from, visit.to), visit.places?.join(', ')].filter(Boolean).join(' · ')}
            </small>
          </span>
          <GoButton onClick={() => onGo(visit.tripId, visit.stopId)} />
        </div>
      ))}
    </>
  );
}

type Flight = TravelLists['flights'][number];

/** Out and back belong together: one block per trip, newest trip first, and
 *  within a trip in the order they were flown. */
function flightsByTrip(flights: Flight[]) {
  const trips = new Map<string, { tripId: string; tripTitle: string; flights: Flight[] }>();
  for (const flight of flights) {
    const trip = trips.get(flight.tripId);
    if (trip) trip.flights.push(flight);
    else trips.set(flight.tripId, { tripId: flight.tripId, tripTitle: flight.tripTitle, flights: [flight] });
  }
  for (const trip of trips.values()) trip.flights.sort((a, b) => a.day.localeCompare(b.day));
  return [...trips.values()];
}

/** What you called the place an airport serves. A stop has your own word for
 *  it; the way back only has the airport's, which would make "Lissabon" on the
 *  way there "Lisbon" on the way home. */
function flightPlaceNames(flights: Flight[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const { from, to } of flights) {
    for (const end of [from, to]) {
      if (end.airport && end.name && !names.has(end.airport)) names.set(end.airport, end.name);
    }
  }
  return names;
}

/** The whole distance, or nothing: a flight without two known airports would
 *  make the total quietly too low. */
function kmInTheAir(flights: Flight[]): number | null {
  let km = 0;
  for (const { from, to } of flights) {
    const a = airportByCode(from.airport);
    const b = airportByCode(to.airport);
    if (!a || !b) return null;
    km += haversineKm([a.lon, a.lat], [b.lon, b.lat]);
  }
  return flights.length > 0 ? Math.round(km) : null;
}

/** One flight as a boarding pass: the route on the ticket, the date on the
 *  stub. Tapping it opens the trip at this flight. */
function FlightTicket({
  flight,
  names,
  still,
  onClick,
}: {
  flight: Flight;
  names: Map<string, string>;
  still: boolean;
  onClick: () => void;
}) {
  const date = new Date(`${flight.day}T12:00:00`);
  const label = (end: FlightEnd) => end.airport ?? endName(end);
  return (
    <button
      type="button"
      className="flight-ticket"
      aria-label={t('trips.statsList.flightLabel', {
        from: label(flight.from),
        to: label(flight.to),
        day: dayLabel(flight.day),
      })}
      onClick={onClick}
    >
      <FlightStrip from={flight.from} to={flight.to} />
      <span className="flight-route">
        <span className="flight-line">
          <FlightCode end={flight.from} names={names} />
          <FlightArc still={still} />
          <FlightCode end={flight.to} names={names} />
        </span>
        <span className="flight-places">
          <FlightPlace end={flight.from} names={names} />
          <FlightPlace end={flight.to} names={names} />
        </span>
      </span>
      <span className="flight-stub">
        <strong>{date.toLocaleDateString(intlLocale(), { day: 'numeric' })}</strong>
        <small>{date.toLocaleDateString(intlLocale(), { month: 'short' }).replace('.', '')}</small>
      </span>
    </button>
  );
}

function placeName(end: FlightEnd, names: Map<string, string>): string {
  return end.name ?? (end.airport ? names.get(end.airport) : undefined) ?? endName(end);
}

/** One end of a flight, the way a boarding pass has it: the airport's code
 *  large. With no airport, the town is large. */
function FlightCode({ end, names }: { end: FlightEnd; names: Map<string, string> }) {
  return (
    <strong className={end.airport ? 'flight-code' : 'flight-code flight-code-name'}>
      {end.airport ?? placeName(end, names)}
    </strong>
  );
}

/** Under the code: the town and its flag, or just the country if the town is
 *  already the large line. */
function FlightPlace({ end, names }: { end: FlightEnd; names: Map<string, string> }) {
  const country = endCountry(end);
  return (
    <span className="flight-city">
      {country && <Flag code={country} size={11} />}
      <span>{end.airport ? placeName(end, names) : country ? countryName(country) : ''}</span>
    </span>
  );
}

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The route between them, drawn at the size it is shown: a line with a light
 *  bow and a dot at either end, and a plane that climbs from the first dot and
 *  levels out on top of it as the row comes in. */
const ARC_W = 112;
const ARC_FROM_X = 5;
const ARC_TO_X = 107;
const ARC_END_Y = 19;
const ARC = `M${ARC_FROM_X} ${ARC_END_Y} Q56 5 ${ARC_TO_X} ${ARC_END_Y}`;

function FlightArc({ still }: { still: boolean }) {
  return (
    <svg className="flight-arc" viewBox={`0 0 ${ARC_W} 24`} aria-hidden="true">
      <path d={ARC} className="flight-arc-line" />
      <circle cx={ARC_FROM_X} cy={ARC_END_Y} r="3.5" className="flight-arc-from" />
      <circle cx={ARC_TO_X} cy={ARC_END_Y} r="3.5" className="flight-arc-to" />
      <g transform={still || REDUCED_MOTION ? 'translate(56 12)' : undefined}>
        <path className="flight-arc-plane" d={PLANE} transform="translate(-12 -12)" />
        {!still && !REDUCED_MOTION && (
          <animateMotion
            dur="0.9s"
            begin="0.15s"
            fill="freeze"
            path={ARC}
            rotate="auto"
            keyPoints="0;0.5"
            keyTimes="0;1"
            calcMode="spline"
            keySplines="0.25 0.6 0.3 1"
          />
        )}
      </g>
    </svg>
  );
}

type StripModule = typeof import('../lib/flightStrip');
let stripModule: Promise<StripModule> | null = null;

/** Everything waiting for its map, one per task, so a long list of flights
 *  never holds up a frame of the sheet coming in or of the scroll. */
const stripQueue: (() => void)[] = [];
let stripTimer: number | null = null;

function runStripQueue() {
  stripTimer = null;
  stripQueue.shift()?.();
  if (stripQueue.length > 0) stripTimer = window.setTimeout(runStripQueue, 0);
}

function queueStrip(job: () => void) {
  stripQueue.push(job);
  // The first ones wait for the sheet to finish sliding up.
  if (stripTimer === null) stripTimer = window.setTimeout(runStripQueue, 300);
}

/** The real earth under the flight, painted once its ticket comes near. A
 *  flight without two known airports has no map and keeps the plain ticket. */
function FlightStrip({ from, to }: { from: FlightEnd; to: FlightEnd }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const a = airportByCode(from.airport);
  const b = airportByCode(to.airport);
  const known = !!a && !!b;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !a || !b) return;
    let cancelled = false;
    let drawnWidth = 0;

    const paint = () => {
      if (cancelled) return;
      const arc = canvas.parentElement?.querySelector('.flight-arc');
      const width = canvas.clientWidth;
      if (!arc || width === 0 || width === drawnWidth) return;
      const box = canvas.getBoundingClientRect();
      const line = arc.getBoundingClientRect();
      const unit = line.width / ARC_W;
      stripModule ??= import('../lib/flightStrip');
      void stripModule.then(async ({ drawFlightStrip }) => {
        if (cancelled) return;
        const drawn = await drawFlightStrip(
          canvas,
          [a.lon, a.lat],
          [b.lon, b.lat],
          {
            x0: line.left - box.left + ARC_FROM_X * unit,
            x1: line.left - box.left + ARC_TO_X * unit,
            y: line.top - box.top + ARC_END_Y * unit,
            width,
            height: canvas.clientHeight,
            scale: Math.min(window.devicePixelRatio || 1, 2),
          },
          '#5b6ee1',
        );
        if (cancelled) return;
        drawnWidth = width;
        setReady(drawn);
      });
    };

    const seen = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        seen.disconnect();
        queueStrip(paint);
      },
      // The list scrolls by itself, so the margin only reaches ahead when it
      // is measured from the list and not from the screen.
      { root: canvas.closest('.stats-list-rows'), rootMargin: '300px 0px' },
    );
    seen.observe(canvas);

    // Turning the phone changes where the route runs across the ticket.
    const resized = new ResizeObserver(() => {
      if (drawnWidth > 0) queueStrip(paint);
    });
    resized.observe(canvas);

    return () => {
      cancelled = true;
      seen.disconnect();
      resized.disconnect();
    };
  }, [a, b]);

  if (!known) return null;
  return <canvas ref={ref} className={ready ? 'flight-strip ready' : 'flight-strip'} aria-hidden="true" />;
}

/** Seen from above, nose to the right. Drawn for this, not out of the icon set. */
const PLANE =
  'M21 12c0-.8-.7-1.4-1.5-1.4H15L10.2 3H8.4l2.4 7.6H6.3L4.6 8.4H3.2l1.1 3.6-1.1 3.6h1.4l1.7-2.2h4.5L8.4 21h1.8L15 13.4h4.5c.8 0 1.5-.6 1.5-1.4z';

function GoButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost stats-list-go" onClick={onClick}>
      {t('trips.statsList.go')}
      <Icon name="chevron-right" size={14} />
    </button>
  );
}
