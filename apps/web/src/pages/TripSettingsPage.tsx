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
import { OfflineMap } from '../components/OfflineMap';
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
import { tripGlyph, tripGlyphSize, tripGlyphStroke } from '../lib/tripGlyph';
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
import { t } from '../i18n';
import { tr } from '../i18n/rich';
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
      .then((loaded) => {
        setTrip(loaded);
        setTitle(loaded.title);
        setStartDate(loaded.startDate.slice(0, 10));
        setEndDate(loaded.endDate.slice(0, 10));
        setAutoTrack(loaded.autoTrack);
        setColor(loaded.color ?? '');
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
      setTrip((prev) => (prev ? { ...prev, title, startDate, endDate, autoTrack } : prev));
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
      setError(err instanceof Error ? err.message : t('tripSettings.error.save'));
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
      setError(err instanceof Error ? err.message : t('tripSettings.error.color'));
    }
  }

  async function saveMarker(pos: [number, number] | null) {
    if (!tripId) return;
    try {
      await api(`/trips/${tripId}`, {
        method: 'PATCH',
        body: { markerLng: pos?.[0] ?? null, markerLat: pos?.[1] ?? null },
      });
      setTrip((prev) => (prev ? { ...prev, markerLng: pos?.[0] ?? null, markerLat: pos?.[1] ?? null } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tripSettings.error.marker'));
    }
  }

  async function wipeRouteFills() {
    if (!tripId) return;
    const ok = await confirmModal({
      title: t('tripSettings.danger.routes.confirmTitle'),
      body: t('tripSettings.danger.routes.confirmBody'),
      confirmLabel: t('tripSettings.danger.wipe'),
      danger: true,
    });
    if (!ok) return;
    setWiping(true);
    setClearMsg(null);
    try {
      const res = await api<{ deleted: number }>(`/trips/${tripId}/route-fill`, { method: 'DELETE' });
      setClearMsg(t('tripSettings.danger.routes.done', { count: res.deleted }));
    } catch (err) {
      setClearMsg(err instanceof Error ? err.message : t('tripSettings.error.wipe'));
    } finally {
      setWiping(false);
    }
  }

  async function remove() {
    if (!tripId) return;
    const ok = await confirmModal({
      title: t('trips.delete.title'),
      body: t('trips.delete.body', { title: trip?.title ?? '' }),
      confirmLabel: t('common.delete'),
      danger: true,
      typeToConfirm: trip?.title,
    });
    if (!ok) return;
    await api(`/trips/${tripId}`, { method: 'DELETE' });
    navigate('/');
  }

  async function wipeTracked(day?: string) {
    if (!tripId) return;
    const ok = await confirmModal({
      title: t('tripSettings.danger.tracked.confirmTitle'),
      body: day
        ? t('tripSettings.danger.tracked.confirmDay', { day })
        : t('tripSettings.danger.tracked.confirmAll'),
      confirmLabel: t('tripSettings.danger.wipe'),
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
      setClearMsg(t('tripSettings.danger.tracked.done', { count: res.deleted }));
      if (day) setClearDay('');
    } catch (err) {
      setClearMsg(err instanceof Error ? err.message : t('tripSettings.error.wipe'));
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
      const found = t('tripSettings.photos.found', { count: result.added, found: result.found });
      setDeviceMsg(
        result.hasLocation
          ? found
          : t('tripSettings.photos.noLocation', { summary: found }),
      );
    } catch (err) {
      setDeviceMsg(err instanceof Error ? err.message : t('tripSettings.error.search'));
    } finally {
      setDeviceBusy(false);
    }
  }

  async function forgetDevicePhotos() {
    if (!tripId) return;
    const ok = await confirmModal({
      title: t('tripSettings.device.unlinkTitle'),
      body: t('tripSettings.device.unlinkBody'),
      confirmLabel: t('tripSettings.device.unlink'),
      danger: true,
    });
    if (!ok) return;
    const removed = await clearDeviceMedia(tripId);
    setDeviceCount(0);
    setDeviceMsg(t('tripSettings.device.unlinked', { count: removed }));
  }

  async function runSync() {
    if (!tripId) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await api<SyncResult>(`/trips/${tripId}/sync`, { method: 'POST' });
      const found = isLocalMode()
        ? t('tripSettings.photos.found', { count: result.assetsAdded, found: result.assetsFound })
        : t('tripSettings.photos.foundWithTravellers', {
            count: result.assetsAdded,
            found: result.assetsFound,
            travellers: t('tripSettings.photos.travellers', { count: result.usersSynced }),
          });
      // Without ACCESS_MEDIA_LOCATION every photo arrives without coordinates,
      // which is worth saying rather than leaving an empty map.
      setSyncMessage(
        result.hasLocation === false
          ? t('tripSettings.photos.noLocation', { summary: found })
          : found,
      );
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : t('tripSettings.error.sync'));
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
          aria-label={t('tripSettings.backToTrip')}
        >
          <Icon name="arrow-left" size={20} />
        </Link>
        <h1>{t('tripSettings.title')}</h1>
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
      {/* And the frame is up before the trip is. It used to wait for the trip
          to load, so the whole page under it dropped a picture's height the
          moment it arrived. Nothing is known about the cover yet, so the frame
          holds its own space and sweeps until it is. */}
      {!trip && (
        <div className="ts-cover">
          <span className="ts-cover-skeleton" aria-hidden="true" />
        </div>
      )}

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
            <span className="ts-cover-glyph" data-glyph={tripGlyph(trip.title)} aria-hidden="true">
              <Icon
                name={tripGlyph(trip.title)}
                size={tripGlyphSize(trip.title, 92)}
                strokeWidth={tripGlyphStroke(trip.title)}
              />
            </span>
          )}
          <span className="ts-cover-hint">
            {tr(trip.resolvedCoverId ? 'tripSettings.cover.pick' : 'tripSettings.cover.none', {
              arrow: () => <Icon name="chevron-right" size={12} />,
            })}
          </span>
        </div>
      )}

      {isOwner ? (
        <form onSubmit={save} className="ts-form">
          <div className="field">
            <label htmlFor="ts-title">{t('tripSettings.name')}</label>
            <input id="ts-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="ts-dates">
            <DateField id="ts-start" label={t('tripSettings.startDate')} value={startDate} onChange={setStartDate} />
            <DateField
              id="ts-end"
              label={t('tripSettings.endDate')}
              value={endDate}
              nearDate={startDate}
              onChange={setEndDate}
            />
          </div>

          <div className="field">
            <label>{t('tripSettings.color.label')}</label>
            <div className="ts-colors">
              <button
                type="button"
                className={`ts-color ts-color-auto ${color === '' ? 'active' : ''}`}
                onClick={() => void saveColor(null)}
                title={t('common.automatic')}
              >
                {t('common.auto')}
              </button>
              {TRIP_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`ts-color ${color.toLowerCase() === hex ? 'active' : ''}`}
                  style={{ background: hex }}
                  onClick={() => void saveColor(hex)}
                  aria-label={t('tripSettings.color.swatch', { hex })}
                />
              ))}
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}
        </form>
      ) : (
        <p className="muted">
          {canEdit
            ? t('tripSettings.notOwner')
            : t('tripSettings.guest')}
        </p>
      )}

      {isOwner && tripId && <FactPicker tripId={tripId} trip={trip} />}

      {syncMessage && <p className="muted ts-sync-msg">{syncMessage}</p>}
      {canEdit && (
      <section className="ts-sync">
        <div>
          <strong>
            {isLocalMode() ? t('tripSettings.sync.titleLocal') : t('tripSettings.sync.titleImmich')}
            <HelpTip>
              {isLocalMode() ? t('tripSettings.sync.helpLocal') : t('tripSettings.sync.helpImmich')}
            </HelpTip>
          </strong>
          <span className="muted">
            {isLocalMode()
              ? t('tripSettings.sync.bodyLocal')
              : t('tripSettings.sync.bodyImmich')}
          </span>
        </div>
        <button className="btn btn-ghost" onClick={runSync} disabled={syncing}>
          {syncing
            ? t('tripSettings.busy')
            : isLocalMode()
              ? t('common.search')
              : t('tripSettings.sync.titleImmich')}
        </button>
      </section>
      )}

      {canEdit && tripId && <OfflineMap tripId={tripId} />}

      {/* Photos you would rather not hand over. They are matched to the trip the
          same way Immich's are, but the files stay on the phone. */}
      {devicePhotos && canEdit && (
        <>
          {deviceMsg && <p className="muted ts-sync-msg">{deviceMsg}</p>}
          <section className="ts-sync ts-sync-stacked">
            <div>
              <strong>
                {t('tripSettings.device.title')}
                <HelpTip>{t('tripSettings.device.help')}</HelpTip>
              </strong>
              <span className="muted">
                {deviceCount
                  ? t('tripSettings.device.count', { count: deviceCount })
                  : t('tripSettings.device.empty')}
              </span>
            </div>
            <div className="ts-device-actions">
              {deviceCount ? (
                <button className="btn btn-ghost ts-device-clear" onClick={forgetDevicePhotos}>
                  {t('tripSettings.device.unlink')}
                </button>
              ) : null}
              <button className="btn btn-ghost" onClick={importFromDevice} disabled={deviceBusy}>
                {deviceBusy ? t('tripSettings.busy') : t('common.search')}
              </button>
            </div>
          </section>
        </>
      )}

      {isOwner && (
        <section className="ts-marker">
          <h2 className="ts-section-title">
            {t('tripSettings.marker.title')}
            <HelpTip>{t('tripSettings.marker.help')}</HelpTip>
          </h2>
          {trip?.markerLng != null && trip.markerLat != null ? (
            <div className="ts-track-box">
              <div>
                <strong>{t('tripSettings.marker.set')}</strong>
                <span className="muted">{t('tripSettings.marker.move')}</span>
              </div>
              <button className="btn btn-ghost" onClick={() => void saveMarker(null)}>
                {t('tripSettings.marker.reset')}
              </button>
            </div>
          ) : markerOn ? (
            <p className="muted">{t('tripSettings.marker.choose')}</p>
          ) : (
            <button className="btn btn-ghost" onClick={() => setMarkerOn(true)}>
              {t('tripSettings.marker.place')}
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
        <h2 className="ts-section-title">{t('tripSettings.tracking.title')}</h2>

        {/* Still running counts as reason enough to show the button: a trip that
            has ended cannot be started, but it can certainly still be stopped,
            and hiding the control left it recording with no way to say no. */}
        {isNative() && tripId && (canTrack || trackingHere) && (
          <div className="ts-track-box">
            <div>
              <strong>{t('tripSettings.tracking.now')}</strong>
              <span className="muted">
                {canTrack
                  ? t('tripSettings.tracking.nowBody')
                  : t('tripSettings.tracking.nowEnded')}
              </span>
            </div>
            <TrackButton tripId={tripId} />
          </div>
        )}
        {isNative() && tripId && !canTrack && !trackingHere && (
          <p className="muted">
            {ended
              ? t('tripSettings.tracking.ended')
              : me?.role === 'GUEST'
                ? t('tripSettings.tracking.guest')
                : t('tripSettings.tracking.notAllowed')}
          </p>
        )}

        {/* The pointer to the app-wide settings lives inside this box rather
            than under it: it is about the same thing the toggle is, and on its
            own it read as a stray line between two framed blocks. */}
        <div className={`ts-auto-box ${ended ? 'ts-disabled' : ''}`}>
          <label className="ts-toggle">
            <div>
              <strong>{t('tripSettings.tracking.auto')}</strong>
              <span className="muted">{t('tripSettings.tracking.autoBody')}</span>
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
            {tr('tripSettings.tracking.more', {
              link: (s) => (
                <Link to="/settings" className="ts-track-link">
                  {s}
                </Link>
              ),
            })}
          </p>
        </div>

      </section>


      {trip && <MembersPanel trip={trip} onChanged={load} />}

      {/* Everything that throws something away, in one place at the bottom of
          the page. Wiping a route used to sit between two settings you change
          every day, which is not where a button that deletes a week of
          tracking belongs. */}
      {(canEdit || isOwner) && (
        <section className="ts-danger">
          <h2 className="ts-section-title">{t('common.delete')}</h2>

          {canEdit && (
            <div className="ts-track-box ts-track-danger">
              <div>
                <strong>{t('tripSettings.danger.tracked.title')}</strong>
                <span className="muted">{t('tripSettings.danger.tracked.body')}</span>
                <div className="ts-wipe-day">
                  <DateField
                    value={clearDay}
                    onChange={setClearDay}
                    allowClear
                    placeholder={t('tripSettings.danger.tracked.pickDay')}
                  />
                  <button
                    className="btn btn-ghost"
                    disabled={!clearDay || wiping}
                    onClick={() => void wipeTracked(clearDay)}
                  >
                    {t('tripSettings.danger.tracked.wipeDay')}
                  </button>
                </div>
              </div>
              <button
                className="btn btn-danger"
                disabled={wiping}
                onClick={() => void wipeTracked()}
              >
                {t('tripSettings.danger.tracked.wipeAll')}
              </button>
            </div>
          )}

          {canEdit && (
            <div className="ts-track-box ts-track-danger">
              <div>
                <strong>{t('tripSettings.danger.routes.title')}</strong>
                <span className="muted">
                  {tr('tripSettings.danger.routes.body', {
                    path: () => (
                      <span className="inline-path">
                        {t('tripSettings.danger.routes.hold')} <Icon name="chevron-right" size={12} />{' '}
                        {t('tripSettings.danger.routes.viaRoads')}
                      </span>
                    ),
                  })}
                </span>
              </div>
              <button
                className="btn btn-ghost"
                disabled={wiping}
                onClick={() => void wipeRouteFills()}
              >
                {t('tripSettings.danger.wipe')}
              </button>
            </div>
          )}
          {clearMsg && <p className="muted">{clearMsg}</p>}

          {isOwner && (
            <div className="ts-actions ts-actions-bottom">
              {/* Full width now that there is no save button beside it — the page
                  saves itself, and the header says so. */}
              <button className="btn btn-danger ts-delete" onClick={remove}>
                <Icon name="trash" size={17} /> {t('tripSettings.danger.deleteTrip')}
              </button>
            </div>
          )}
        </section>
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
        {t('tripSettings.facts.title')}
        <HelpTip>{t('tripSettings.facts.help')}</HelpTip>
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
          {t('common.automatic')}
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
