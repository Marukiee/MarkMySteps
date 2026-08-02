import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ConnectionStatus, SyncResult, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { confirmModal } from '../components/confirm';
import { DateField } from '../components/DatePicker';
import { HelpTip } from '../components/HelpTip';
import { Icon } from '../components/Icon';
import { TripFacts } from '../components/TripFacts';
import {
  clearDeviceMedia,
  deviceMediaSupported,
  importDeviceMedia,
  listDeviceMedia,
} from '../lib/deviceMedia';
import { tripCoverBg } from '../lib/colors';
import { isLocalMode } from '../lib/localMode';
import { canEditTrip, canTrackTrip } from '../lib/perm';
import { tripGlyph, tripGlyphSize } from '../lib/tripGlyph';
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
import { isNative, onTrackerChange, startTracking } from '../tracking/tracker';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [color, setColor] = useState<string>('');
  const [markerOn, setMarkerOn] = useState(false);
  const [clearDay, setClearDay] = useState('');
  const [wiping, setWiping] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  // Photos kept on this phone instead of on the server (see lib/deviceMedia).
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceMsg, setDeviceMsg] = useState<string | null>(null);
  /** Whether the tracker is on THIS trip right now — see the tracking section. */
  const [trackingHere, setTrackingHere] = useState(false);

  useEffect(() => onTrackerChange((s) => setTrackingHere(!!tripId && s.tripId === tripId)), [tripId]);

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
  // A guest contributes nothing to the trip — no photos of their own, from
  // Immich or from their gallery, and no track.
  const canEdit = canEditTrip(trip, user?.id);
  const canTrack = !ended && canTrackTrip(trip, user?.id);

  /**
   * Saves on its own, shortly after you stop typing.
   *
   * The explicit button read as optional — a colour or a marker saved itself
   * the moment you touched it, while the title quietly waited for a press
   * nobody made. Now everything on this page behaves the same way.
   */
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!trip || !isOwner) return;
    // Not on the first render: `load()` fills these in, and that is not an edit.
    const unchanged =
      title === trip.title &&
      startDate === trip.startDate.slice(0, 10) &&
      endDate === trip.endDate.slice(0, 10) &&
      autoTrack === trip.autoTrack;
    if (unchanged) return;
    dirty.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), 700);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, startDate, endDate, autoTrack, trip, isOwner]);

  // Leaving the page mid-edit must not lose the last keystroke.
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (dirty.current) void save();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!tripId) return;
    setError(null);
    dirty.current = false;
    setSaving(true);
    try {
      await api(`/trips/${tripId}`, {
        method: 'PATCH',
        body: { title, startDate, endDate, autoTrack },
      });
      // Keep the local copy in step, or the effect above sees an edit again.
      setTrip((t) => (t ? { ...t, title, startDate, endDate, autoTrack } : t));
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
    } finally {
      setSaving(false);
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
      body: `"${trip?.title}" wordt definitief verwijderd, samen met de route, de notities en de foto-koppelingen. Dit kan niet ongedaan gemaakt worden.`,
      confirmLabel: 'Verwijderen',
      danger: true,
      typeToConfirm: trip?.title,
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

  // Whether this account has an Immich server behind it. null = not asked yet,
  // which is not the same as "no" — the section stays away until we know.
  const [immichLinked, setImmichLinked] = useState<boolean | null>(null);

  useEffect(() => {
    if (isLocalMode() || !deviceMediaSupported()) return;
    api<ConnectionStatus>('/immich/connection')
      .then(() => setImmichLinked(true))
      // A 404 is the normal answer for "never configured". Any other failure is
      // a server we could not ask, and the gallery is the useful fallback then.
      .catch(() => setImmichLinked(false));
  }, []);

  // Only when there is a phone to read them off, only for a trip that lives on
  // a server, and only without Immich: with a library attached, the photos come
  // from there and a second, device-only source is just a way to lose them.
  const devicePhotos = deviceMediaSupported() && !isLocalMode() && immichLinked === false;

  useEffect(() => {
    if (!tripId || !devicePhotos) return;
    void listDeviceMedia(tripId)
      .then((rows) => setDeviceCount(rows.length))
      .catch(() => setDeviceCount(0));
  }, [tripId, devicePhotos]);

  async function importFromDevice() {
    if (!tripId || !trip || !user) return;
    setDeviceBusy(true);
    setDeviceMsg(null);
    try {
      const result = await importDeviceMedia(tripId, trip.startDate, trip.endDate, user.id);
      setDeviceCount((c) => (c ?? 0) + result.added);
      const found = `${result.added} nieuwe foto's (${result.found} gevonden)`;
      setDeviceMsg(
        result.hasLocation
          ? found
          : `${found}. Let op: zonder toegang tot de locatie in foto's komen ze niet op de kaart.`,
      );
    } catch (err) {
      setDeviceMsg(err instanceof Error ? err.message : 'Zoeken mislukt');
    } finally {
      setDeviceBusy(false);
    }
  }

  async function forgetDevicePhotos() {
    if (!tripId) return;
    const ok = await confirmModal({
      title: "Foto's van dit toestel loskoppelen?",
      body: 'De foto\'s zelf blijven gewoon in je galerij staan. Ze verdwijnen alleen uit deze reis.',
      confirmLabel: 'Loskoppelen',
      danger: true,
    });
    if (!ok) return;
    const removed = await clearDeviceMedia(tripId);
    setDeviceCount(0);
    setDeviceMsg(`${removed} foto's losgekoppeld.`);
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
      {/* Back button as a plain round icon, so the title can sit in the middle
          of the row rather than wherever the button leaves room. */}
      <div className="ts-head">
        <Link
          to={`/trips/${tripId}`}
          className="ts-back"
          aria-label="Terug naar de reis"
        >
          <Icon name="arrow-left" size={20} />
        </Link>
        <h1>Reisinstellingen</h1>
        <span className="ts-autosave" data-state={saving ? 'saving' : saved ? 'saved' : 'idle'}>
          <span className="ts-autosave-face" key={saving ? 'saving' : saved ? 'saved' : 'idle'}>
            {saving ? <Icon name="hourglass" size={16} /> : saved ? <Icon name="check" size={16} /> : null}
          </span>
        </span>
      </div>

      {/* Always the same frame, whether or not there is a photo in it. It used
          to appear only once a cover existed, so a trip that has not happened
          yet showed the loading sweep for an instant and then dropped the
          whole block — which read as the page glitching. No photo now means
          the trip's own colour and its glyph, exactly like its card. */}
      {trip && (
        <div
          className={`ts-cover ${trip.resolvedCoverId ? '' : 'no-photo'}`}
          style={trip.resolvedCoverId ? undefined : { background: tripCoverBg(trip) }}
        >
          {trip.resolvedCoverId ? (
            <>
              {/* Holds the frame's space until the photo has decoded. */}
              <span className="ts-cover-skeleton" aria-hidden="true" />
              <AuthImage
                path={`/media/${trip.resolvedCoverId}/thumbnail`}
                alt=""
                className="ts-cover-img"
              />
            </>
          ) : (
            <span className="ts-cover-glyph" aria-hidden="true">
              <Icon name={tripGlyph(trip.title)} size={tripGlyphSize(trip.title, 92)} />
            </span>
          )}
          <span className="ts-cover-hint">
            {trip.resolvedCoverId
              ? 'Kies een coverfoto: tik een foto '
              : "Nog geen foto's. Tik er straks één aan "}
            <Icon name="chevron-right" size={12} /> “Als cover”
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
        <p className="muted">
          {canEdit
            ? 'Alleen de organisator kan de reisinstellingen wijzigen.'
            : 'Je bent gast op deze reis: je kunt hem bekijken, niet aanpassen.'}
        </p>
      )}

      {isOwner && tripId && <FactPicker tripId={tripId} trip={trip} />}

      {syncMessage && <p className="muted ts-sync-msg">{syncMessage}</p>}
      {canEdit && (
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
      )}

      {/* Photos you would rather not hand over. They are matched to the trip the
          same way Immich's are, but the files stay on the phone. */}
      {devicePhotos && canEdit && (
        <>
          {deviceMsg && <p className="muted ts-sync-msg">{deviceMsg}</p>}
          <section className="ts-sync ts-sync-stacked">
            <div>
              <strong>
                Foto&apos;s van dit toestel
                <HelpTip>
                  Zoekt in je galerij naar foto&apos;s van deze reisdagen en zet ze in je tijdlijn
                  en op de kaart, zonder ze te uploaden. Ze staan dan alleen op dit toestel: je
                  reisgenoten zien ze niet, ze gaan niet mee in een deel-link, en op een nieuwe
                  telefoon zijn ze er niet. De foto&apos;s zelf blijven gewoon in je galerij.
                </HelpTip>
              </strong>
              <span className="muted">
                {deviceCount
                  ? `${deviceCount} foto${deviceCount === 1 ? '' : "'s"} van dit toestel in deze reis.`
                  : 'Uit je galerij, zonder ze naar de server te sturen.'}
              </span>
            </div>
            <div className="ts-device-actions">
              {deviceCount ? (
                <button className="btn btn-ghost ts-device-clear" onClick={forgetDevicePhotos}>
                  Loskoppelen
                </button>
              ) : null}
              <button className="btn btn-ghost" onClick={importFromDevice} disabled={deviceBusy}>
                {deviceBusy ? 'Bezig…' : 'Zoeken'}
              </button>
            </div>
          </section>
        </>
      )}

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

        {/* Still running counts as reason enough to show the button: a trip that
            has ended cannot be started, but it can certainly still be stopped,
            and hiding the control left it recording with no way to say no. */}
        {isNative() && tripId && (canTrack || trackingHere) && (
          <div className="ts-track-box">
            <div>
              <strong>Route nu bijhouden</strong>
              <span className="muted">
                {canTrack
                  ? 'Start of stop het volgen van je route voor deze reis.'
                  : 'Deze reis is afgelopen. Tracking loopt nog en stopt vanzelf, of nu.'}
              </span>
            </div>
            <TrackButton tripId={tripId} />
          </div>
        )}
        {isNative() && tripId && !canTrack && !trackingHere && (
          <p className="muted">
            {ended
              ? 'Deze reis is afgelopen, tracken kan niet meer.'
              : me?.role === 'GUEST'
                ? 'Je bent gast op deze reis en kunt alleen meekijken.'
                : 'De organisator heeft tracken voor jou uitgezet.'}
          </p>
        )}

        {/* The pointer to the app-wide settings lives inside this box rather
            than under it: it is about the same thing the toggle is, and on its
            own it read as a stray line between two framed blocks. */}
        <div className={`ts-auto-box ${ended ? 'ts-disabled' : ''}`}>
          <label className="ts-toggle">
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
          <p className="muted ts-track-hint">
            Meer opties staan bij{' '}
            <Link to="/settings" className="ts-track-link">
              de tracking-instellingen
            </Link>
            .
          </p>
        </div>

        {canEdit && (
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
        )}

        {canEdit && (
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
        )}
        {clearMsg && <p className="muted">{clearMsg}</p>}
      </section>


      {trip && <MembersPanel trip={trip} onChanged={load} />}

      {isOwner && (
        <div className="ts-actions ts-actions-bottom">
          {/* Full width now that there is no save button beside it — the page
              saves itself, and the header says so. */}
          <button className="btn btn-danger ts-delete" onClick={remove}>
            <Icon name="trash" size={17} /> Reis verwijderen
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

      {/* No photo yet (an upcoming trip) → the trip's own colour and the
          compass, which is what its cover will actually look like until a
          photo lands. An empty grey panel read as a preview that had failed. */}
      <div
        className={`ts-facts-preview ${trip?.resolvedCoverId ? 'has-cover' : 'no-photo'}`}
        style={trip && !trip.resolvedCoverId ? { background: tripCoverBg(trip) } : undefined}
      >
        {trip?.resolvedCoverId && (
          <AuthImage
            path={`/media/${trip.resolvedCoverId}/thumbnail`}
            alt=""
            className="ts-facts-preview-img"
          />
        )}
        {trip && !trip.resolvedCoverId && (
          <span className="ts-facts-preview-glyph" aria-hidden="true">
            <Icon name="compass" size={96} />
          </span>
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
