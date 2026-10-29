import { CSSProperties, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getLang, intlLocale, t } from '../i18n';
import { airportByCode } from '../lib/airports';
import { popWasOurs, skipNextPop } from '../lib/backStack';
import { formatDateRange } from '../lib/colors';
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
            lists.flights.map((flight, i) => {
              const fromCountry = endCountry(flight.from);
              const toCountry = endCountry(flight.to);
              const codes = [flight.from.airport, flight.to.airport].every(Boolean)
                ? `${flight.from.airport} → ${flight.to.airport}`
                : null;
              return (
                <Row key={`${flight.tripId}/${flight.stopId}/${flight.day}`} i={i}>
                  <div className="stats-list-top stats-list-flight">
                    {fromCountry && <Flag code={fromCountry} size={14} />}
                    <strong>{endName(flight.from)}</strong>
                    <Icon name="plane" size={14} className="stats-list-plane" />
                    {toCountry && <Flag code={toCountry} size={14} />}
                    <strong>{endName(flight.to)}</strong>
                  </div>
                  <div className="stats-list-visit">
                    <span className="stats-list-what">
                      <span>{flight.tripTitle}</span>
                      <small>{[dayLabel(flight.day), codes].filter(Boolean).join(' · ')}</small>
                    </span>
                    <GoButton onClick={() => go(flight.tripId, flight.stopId)} />
                  </div>
                </Row>
              );
            })}

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
  // Only the first screenful steps in one after another; a long list would
  // otherwise still be arriving a second later.
  return (
    <li className="stats-list-row" style={{ '--i': Math.min(i, 12) } as CSSProperties}>
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

function GoButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost stats-list-go" onClick={onClick}>
      {t('trips.statsList.go')}
      <Icon name="chevron-right" size={15} />
    </button>
  );
}
