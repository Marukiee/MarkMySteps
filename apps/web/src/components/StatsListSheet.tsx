import { CSSProperties, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getLang, intlLocale, t } from '../i18n';
import { airportByCode } from '../lib/airports';
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
          <h2>{title}</h2>
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
            lists.flights.map((flight, i) => (
              <Row key={`${flight.tripId}/${flight.stopId}/${flight.day}`} i={i}>
                <div className="flight-route">
                  <FlightEndLabel end={flight.from} />
                  <FlightArc still={i > 12} />
                  <FlightEndLabel end={flight.to} />
                </div>
                <div className="stats-list-visit">
                  <span className="stats-list-what">
                    <span>{flight.tripTitle}</span>
                    <small>{dayLabel(flight.day)}</small>
                  </span>
                  <GoButton onClick={() => go(flight.tripId, flight.stopId)} />
                </div>
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

function Row({ i, children }: { i: number; children: React.ReactNode }) {
  // Only the first screenful steps in one after another; the rest is out of
  // sight at that moment, and animating it would only cost the scroll frames.
  return (
    <li className={i > 12 ? 'stats-list-row' : 'stats-list-row stats-list-row-in'} style={{ '--i': i } as CSSProperties}>
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

/** One end of a flight, the way a boarding pass has it: the airport's code
 *  large, the town and its flag under it. With no airport, the town is large. */
function FlightEndLabel({ end }: { end: FlightEnd }) {
  const country = endCountry(end);
  const city = endName(end);
  return (
    <span className="flight-end">
      <strong className={end.airport ? 'flight-code' : 'flight-code flight-code-name'}>
        {end.airport ?? city}
      </strong>
      <span className="flight-city">
        {country && <Flag code={country} size={11} />}
        <span>{end.airport ? city : country ? countryName(country) : ''}</span>
      </span>
    </span>
  );
}

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The route between them: a dotted arc, and a plane that takes off from the
 *  first dot and levels out on top of it as the row comes in. */
const ARC = 'M6 24 Q52 -6 98 24';

function FlightArc({ still }: { still: boolean }) {
  return (
    <svg className="flight-arc" viewBox="0 0 104 30" aria-hidden="true">
      <path d={ARC} className="flight-arc-line" />
      <circle cx="6" cy="24" r="3" className="flight-arc-from" />
      <circle cx="98" cy="24" r="3" className="flight-arc-to" />
      <g transform={still || REDUCED_MOTION ? 'translate(52 9)' : undefined}>
        <path className="flight-arc-plane" d={PLANE} transform="scale(0.85) translate(-12 -12)" />
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
