import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { SyncResult, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { confirmModal } from '../components/confirm';
import { DateField } from '../components/DatePicker';
import { HelpTip } from '../components/HelpTip';
import { Icon } from '../components/Icon';
import { TripFacts } from '../components/TripFacts';
import { isLocalMode } from '../lib/localMode';
import { getTripFacts, setTripFacts } from '../lib/prefs';
import {
  FACT_NAMES,
  FACT_ORDER,
  FactId,
  FactSource,
  MAX_FACTS,
  resolveFacts,
} from '../lib/tripFacts';
import { MembersPanel } from '../components/MembersPanel';
import { TripMarkerPicker } from '../components/TripMarkerPicker';
import { TrackButton } from '../components/TrackButton';
import { isNative, startTracking } from '../tracking/tracker';
import './tripsettings.css';

// Curated, legible swatches for the trip colour picker.
const TRIP_COLORS = [
  '#e8613c',
  '#e0993a',
  '#4ca05c',
  '#2a8f85',
  '#409ec5',
  '#5a6ee1',
  '#b054a8',
  '#df5c78',
];

/** Polarsteps-style "Edit trip" screen. */
export function TripSettingsPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [autoTrack, setAutoTrack] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [color, setColor] = useState<string>('');
  const [markerOn, setMarkerOn] = useState(false);
  const [clearDay, setClearDay] = useState('');
  const [wiping, setWiping] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);

  function load() {
    if (!tripId) return;
    api<Trip>(`/trips/${tripId}`)
      .then((t) => {
        setTrip(t);
        setTitle(t.title);
        setStartDate(t.startDate.slice(0, 10));
        setEndDate(t.endDate.slice(0, 10));
        setAutoTrack(t.autoTrack);
        setColor(t.color ?? '');
      })
      .catch((e: Error) => setError(e.message));
  }
  useEffect(load, [tripId]);

  const isOwner = trip?.ownerId === user?.id;
  const me = trip?.members.find((m) => m.userId === user?.id);
  const ended = !!trip && new Date(trip.endDate).getTime() + 86_400_000 < Date.now();
  const canTrack =
    !ended && !!me && (me.role === 'OWNER' || (me.role === 'MEMBER' && me.canTrack));

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!tripId) return;
    setError(null);
    try {
      await api(`/trips/${tripId}`, {
        method: 'PATCH',
        body: { title, startDate, endDate, autoTrack },
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
      // If you switch auto-track on while the trip is already running, start
      // tracking now instead of waiting for the next app launch.
      const now = Date.now();
      const started =
        autoTrack &&
        isNative() &&
        now >= new Date(startDate).getTime() &&
        now <= new Date(endDate).getTime() + 86_400_000;
      if (started && tripId) void startTracking(tripId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opslaan mislukt');
    }
  }

  async function saveColor(hex: string | null) {
    if (!tripId) return;
    setColor(hex ?? '');
    try {
      await api(`/trips/${tripId}`, { method: 'PATCH', body: { color: hex } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kleur opslaan mislukt');
    }
  }

  async function saveMarker(pos: [number, number] | null) {
    if (!tripId) return;
    try {
      await api(`/trips/${tripId}`, {
        method: 'PATCH',
        body: { markerLng: pos?.[0] ?? null, markerLat: pos?.[1] ?? null },
      });
      setTrip((t) => (t ? { ...t, markerLng: pos?.[0] ?? null, markerLat: pos?.[1] ?? null } : t));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Markering opslaan mislukt');
    }
  }

  async function wipeRouteFills() {
    if (!tripId) return;
    const ok = await confirmModal({
      title: 'Automatische routes wissen?',
      body: 'Alleen de automatisch getekende routes (via wegen) worden verwijderd. Je eigen getrackte GPS blijft staan.',
      confirmLabel: 'Wissen',
      danger: true,
    });
    if (!ok) return;
    setWiping(true);
    setClearMsg(null);
    try {
      const res = await api<{ deleted: number }>(`/trips/${tripId}/route-fill`, { method: 'DELETE' });
      setClearMsg(`${res.deleted} automatische routepunten verwijderd.`);
    } catch (err) {
      setClearMsg(err instanceof Error ? err.message : 'Wissen mislukt');
    } finally {
      setWiping(false);
    }
  }

  async function remove() {
    if (!tripId) return;
    const ok = await confirmModal({
      title: 'Reis verwijderen?',
      body: `"${trip?.title}" wordt definitief verwijderd, samen met de routes en foto-koppelingen.`,
      confirmLabel: 'Verwijderen',
      danger: true,
    });
    if (!ok) return;
    await api(`/trips/${tripId}`, { method: 'DELETE' });
    navigate('/');
  }

  async function wipeTracked(day?: string) {
    if (!tripId) return;
    const scope = day ? `de tracking van ${day}` : 'ALLE getrackte data van deze reis';
    const ok = await confirmModal({
      title: 'Tracking wissen?',
      body: `Weet je zeker dat je ${scope} wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`,
      confirmLabel: 'Wissen',
      danger: true,
    });
    if (!ok) return;
    setWiping(true);
    setClearMsg(null);
    try {
      const res = await api<{ deleted: number }>(
        `/trips/${tripId}/tracked${day ? `?day=${day}` : ''}`,
        { method: 'DELETE' },
      );
      setClearMsg(`${res.deleted} trackpunten verwijderd.`);
      if (day) setClearDay('');
    } catch (err) {
      setClearMsg(err instanceof Error ? err.message : 'Wissen mislukt');
    } finally {
      setWiping(false);
    }
  }

  async function runSync() {
    if (!tripId) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await api<SyncResult>(`/trips/${tripId}/sync`, { method: 'POST' });
      const found = isLocalMode()
        ? `${result.assetsAdded} nieuwe foto's (${result.assetsFound} gevonden)`
        : `${result.assetsAdded} nieuwe foto's (${result.assetsFound} gevonden, ${result.usersSynced} reiziger${result.usersSynced === 1 ? '' : 's'})`;
      // Without ACCESS_MEDIA_LOCATION every photo arrives without coordinates,
      // which is worth saying rather than leaving an empty map.
      setSyncMessage(
        result.hasLocation === false
          ? `${found}. Let op: zonder toegang tot de locatie in foto's komen ze niet op de kaart.`
          : found,
      );
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Sync mislukt');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="page fade-in trip-settings">
      <div className="ts-head">
        <Link to={`/trips/${tripId}`} className="btn btn-ghost">
          <Icon name="arrow-left" size={16} /> Terug
        </Link>
        <h1>Reisinstellingen</h1>
      </div>

      {trip?.resolvedCoverId && (
        <div className="ts-cover">
          {/* Holds the frame's space until the photo has decoded. */}
          <span className="ts-cover-skeleton" aria-hidden="true" />
          <AuthImage path={`/media/${trip.resolvedCoverId}/thumbnail`} alt="" className="ts-cover-img" />
          <span className="ts-cover-hint">
            Kies een coverfoto: tik een foto <Icon name="chevron-right" size={12} /> “Als cover”
          </span>
        </div>
      )}

      {isOwner ? (
        <form onSubmit={save} className="ts-form">
          <div className="field">
            <label htmlFor="ts-title">Naam</label>
            <input id="ts-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="ts-dates">
            <DateField id="ts-start" label="Startdatum" value={startDate} onChange={setStartDate} />
            <DateField
              id="ts-end"
              label="Einddatum"
              value={endDate}
              nearDate={startDate}
              onChange={setEndDate}
            />
          </div>

          <div className="field">
            <label>Kleur op de globe &amp; kaart</label>
            <div className="ts-colors">
              <button
                type="button"
                className={`ts-color ts-color-auto ${color === '' ? 'active' : ''}`}
                onClick={() => void saveColor(null)}
                title="Automatisch"
              >
                Auto
              </button>
              {TRIP_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`ts-color ${color.toLowerCase() === hex ? 'active' : ''}`}
                  style={{ background: hex }}
                  onClick={() => void saveColor(hex)}
                  aria-label={`Kleur ${hex}`}
                />
              ))}
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}
        </form>
      ) : (
        <p className="muted">Alleen de organisator kan de reisinstellingen wijzigen.</p>
      )}

      {isOwner && tripId && <FactPicker tripId={tripId} trip={trip} />}

      {syncMessage && <p className="muted ts-sync-msg">{syncMessage}</p>}
      <section className="ts-sync">
        <div>
          <strong>{isLocalMode() ? "Foto's koppelen" : "Foto's syncen"}</strong>
          <span className="muted">
            {isLocalMode()
              ? "Zoekt in je fotobibliotheek naar foto's van deze reisdagen en zet ze met hun GPS op de kaart."
              : "Haal nieuwe foto's met GPS uit Immich op voor deze reis."}
          </span>
        </div>
        <button className="btn btn-ghost" onClick={runSync} disabled={syncing}>
          {syncing ? 'Bezig…' : isLocalMode() ? 'Zoeken' : "Foto's syncen"}
        </button>
      </section>

      {isOwner && (
        <section className="ts-marker">
          <h2 className="ts-section-title">
            Bolletje op de globe
            <HelpTip>
              Handig bij een rondreis (bv. interrail) waar begin en eind bijna gelijk zijn: zet het
              ene bolletje en naamkaartje op een plek langs de route die het beste uitkomt.
              Standaard staat het automatisch op begin/eind.
            </HelpTip>
          </h2>
          {trip?.markerLng != null && trip.markerLat != null ? (
            <div className="ts-track-box">
              <div>
                <strong>Eigen positie ingesteld</strong>
                <span className="muted">Sleep de pin of tik op de kaart om te verplaatsen.</span>
              </div>
              <button className="btn btn-ghost" onClick={() => void saveMarker(null)}>
                Terug naar automatisch
              </button>
            </div>
          ) : markerOn ? (
            <p className="muted">Sleep de pin of tik op de kaart om de plek te kiezen.</p>
          ) : (
            <button className="btn btn-ghost" onClick={() => setMarkerOn(true)}>
              Bolletje handmatig plaatsen
            </button>
          )}
          {(markerOn || (trip?.markerLng != null && trip.markerLat != null)) && trip && tripId && (
            <TripMarkerPicker
              tripId={tripId}
              initial={
                trip.markerLng != null && trip.markerLat != null
                  ? [trip.markerLng, trip.markerLat]
                  : trip.anchor
              }
              onChange={(pos) => void saveMarker(pos)}
            />
          )}
        </section>
      )}

      <section className="ts-tracking">
        <h2 className="ts-section-title">Tracking</h2>

        {isNative() && tripId && canTrack && (
          <div className="ts-track-box">
            <div>
              <strong>Route nu bijhouden</strong>
              <span className="muted">Start of stop het volgen van je route voor deze reis.</span>
            </div>
            <TrackButton tripId={tripId} />
          </div>
        )}
        {isNative() && tripId && !canTrack && (
          <p className="muted">
            {ended
              ? 'Deze reis is afgelopen, tracken kan niet meer.'
              : me?.role === 'GUEST'
                ? 'Je bent gast op deze reis en kunt alleen meekijken.'
                : 'De organisator heeft tracken voor jou uitgezet.'}
          </p>
        )}

        <label className={`ts-toggle ${ended ? 'ts-disabled' : ''}`}>
          <div>
            <strong>Automatisch tracken</strong>
            <span className="muted">
              Start route-tracking automatisch zodra de reis begint (app, op de achtergrond).
            </span>
          </div>
          <input
            type="checkbox"
            checked={autoTrack}
            disabled={!isOwner || ended}
            onChange={(e) => {
              setAutoTrack(e.target.checked);
              if (isOwner) void save();
            }}
          />
        </label>

        <div className="ts-track-box ts-track-danger">
          <div>
            <strong>Getrackte data wissen</strong>
            <span className="muted">
              Verwijdert jouw GPS-route (de reis en foto's blijven). Kies een dag, of wis alles.
            </span>
            <div className="ts-wipe-day">
              <DateField
                value={clearDay}
                onChange={setClearDay}
                allowClear
                placeholder="Kies een dag"
              />
              <button
                className="btn btn-ghost"
                disabled={!clearDay || wiping}
                onClick={() => void wipeTracked(clearDay)}
              >
                Wis dag
              </button>
            </div>
          </div>
          <button className="btn btn-danger" disabled={wiping} onClick={() => void wipeTracked()}>
            Alles wissen
          </button>
        </div>

        <div className="ts-track-box">
          <div>
            <strong>Automatisch getekende routes wissen</strong>
            <span className="muted">
              Verwijdert alleen de routes die je hebt getekend via{' '}
              <span className="inline-path">
                Ingedrukt houden <Icon name="chevron-right" size={12} /> Route via wegen
              </span>
              . Je eigen getrackte GPS blijft staan.
            </span>
          </div>
          <button className="btn btn-ghost" disabled={wiping} onClick={() => void wipeRouteFills()}>
            Wissen
          </button>
        </div>
        {clearMsg && <p className="muted">{clearMsg}</p>}
      </section>


      {trip && <MembersPanel trip={trip} onChanged={load} />}

      {isOwner && (
        <div className="ts-actions ts-actions-bottom">
          <button className="btn btn-danger" onClick={remove}>
            Reis verwijderen
          </button>
          <button className="btn btn-primary" onClick={() => void save()}>
            {saved ? (
              <>
                <Icon name="check" size={16} /> Opgeslagen
              </>
            ) : (
              'Wijzigingen opslaan'
            )}
          </button>
        </div>
      )}
    </main>
  );
}

interface FactStats {
  distanceKm: number;
  countries: string[];
  days: number;
  photoCount: number;
}

/**
 * Choose which four chips appear on this trip's header, with the real thing as
 * a live preview. "Auto" clears the choice and falls back to the priority
 * order (afstand, dagen, stops, foto's, reisgenoten).
 */
function FactPicker({ tripId, trip }: { tripId: string; trip: Trip | null }) {
  const [stats, setStats] = useState<FactStats | null>(null);
  const [stopCount, setStopCount] = useState(0);
  const [chosen, setChosen] = useState<FactId[] | null>(
    () => (getTripFacts(tripId) as FactId[] | null) ?? null,
  );

  useEffect(() => {
    api<FactStats>(`/trips/${tripId}/stats`).then(setStats).catch(() => undefined);
    api<{ latitude: number | null }[]>(`/trips/${tripId}/stops`)
      .then((rows) => setStopCount(rows.filter((r) => r.latitude !== null).length))
      .catch(() => undefined);
  }, [tripId]);

  const source: FactSource = {
    distanceKm: stats?.distanceKm ?? 0,
    days: stats?.days ?? 0,
    stops: stopCount,
    photoCount: stats?.photoCount ?? 0,
    travellers: trip?.members.length ?? 0,
    countries: stats?.countries.length ?? 0,
  };

  const toggle = (id: FactId) => {
    const current = chosen ?? [];
    const next = current.includes(id)
      ? current.filter((f) => f !== id)
      : current.length >= MAX_FACTS
        ? current
        : [...current, id];
    setChosen(next.length > 0 ? next : null);
    setTripFacts(tripId, next.length > 0 ? next : null);
  };

  const auto = chosen === null;

  return (
    <section className="ts-facts">
      <h2 className="ts-section-title">
        Feitjes op de cover
        <HelpTip>
          Er is plek voor vier. Zonder eigen keuze pakt de app automatisch de eerste vier die deze
          reis heeft: afstand, dagen, stops, foto's, reisgenoten.
        </HelpTip>
      </h2>

      <div className={`ts-facts-preview ${trip?.resolvedCoverId ? 'has-cover' : ''}`}>
        {trip?.resolvedCoverId && (
          <AuthImage
            path={`/media/${trip.resolvedCoverId}/thumbnail`}
            alt=""
            className="ts-facts-preview-img"
          />
        )}
        <div className="ts-facts-preview-body">
          <TripFacts facts={resolveFacts(source, chosen)} />
        </div>
      </div>

      <div className="ts-facts-options">
        <button
          type="button"
          className={`ts-fact-opt ts-fact-auto ${auto ? 'active' : ''}`}
          onClick={() => {
            setChosen(null);
            setTripFacts(tripId, null);
          }}
        >
          <span className="ts-fact-check">{auto && <Icon name="check" size={14} />}</span>
          Automatisch
        </button>
        {FACT_ORDER.map((id) => {
          const on = chosen?.includes(id) ?? false;
          const full = !on && (chosen?.length ?? 0) >= MAX_FACTS;
          return (
            <button
              key={id}
              type="button"
              className={`ts-fact-opt ${on ? 'active' : ''}`}
              disabled={full}
              onClick={() => toggle(id)}
            >
              <span className="ts-fact-check">{on && <Icon name="check" size={14} />}</span>
              {FACT_NAMES[id]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
