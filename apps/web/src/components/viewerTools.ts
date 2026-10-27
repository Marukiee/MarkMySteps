import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ConnectionStatus, MediaItem } from '../api/types';
import { DEFAULT_IMMICH_PUBLIC_URL } from '../config';
import { isDeviceMediaId } from '../lib/deviceMedia';
import { reversePlaceName } from '../lib/geocode';
import { legTitle } from '../lib/legs';
import { openExternal } from '../lib/native';
import { savePhoto } from '../lib/photoSave';
import { t } from '../i18n';
import type { IconName } from './Icon';

/**
 * What the photo viewer's menu offers and what it says while doing it, shared
 * by the viewer on the page and the native one on the iPhone: the same four
 * actions under the same conditions, whichever of the two draws them.
 */
export interface ViewerAction {
  id: 'cover' | 'stopCover' | 'download' | 'immich';
  label: string;
  icon: IconName;
  /** The SF Symbol that says the same, for the native menu. */
  symbol: string;
  run: () => void;
}

export interface ViewerToolsOptions {
  item: MediaItem | undefined;
  /** Signed in as this user; the share page has nobody. */
  userId: string | undefined;
  coverTripId?: string;
  onCoverSet?: () => void;
  stopCoverFor?: (item: MediaItem) => { id: string; name: string } | null;
  onSetStopCover?: (stopId: string, mediaId: string) => Promise<void>;
  srcFor?: (item: MediaItem, size: 'thumbnail' | 'preview' | 'original') => string;
}

export function useViewerTools({
  item,
  userId,
  coverTripId,
  onCoverSet,
  stopCoverFor,
  onSetStopCover,
  srcFor,
}: ViewerToolsOptions) {
  const isPublic = Boolean(srcFor);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  // Each by the photo it was done to, so the photo next to it, whose menu the
  // native viewer has ready before you page to it, does not say it too.
  const [coverSaved, setCoverSaved] = useState<string | null>(null);
  const [stopCoverSaved, setStopCoverSaved] = useState<string | null>(null);
  // A download is the one action here that takes long enough to need saying
  // something about, and it says it over the photo rather than in the menu it
  // was started from: the menu is closed by the time the file arrives.
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function setAsCover(target: MediaItem) {
    if (!coverTripId) return;
    await api(`/trips/${coverTripId}`, { method: 'PATCH', body: { coverMediaId: target.id } });
    setCoverSaved(target.id);
    window.setTimeout(() => setCoverSaved(null), 1600);
    onCoverSet?.();
  }

  async function setAsStopCover(target: MediaItem, stopId: string) {
    if (!onSetStopCover) return;
    await onSetStopCover(stopId, target.id);
    setStopCoverSaved(target.id);
    window.setTimeout(() => setStopCoverSaved(null), 1600);
  }

  async function saveToDevice(target: MediaItem) {
    if (saving) return;
    setSaving(target.id);
    setNote(t('trip.viewer.downloading'));
    const outcome = await savePhoto(target, srcFor);
    setSaving(null);
    // A share sheet the user waved away is not a failure, and it has already
    // told them what happened: say nothing.
    if (outcome === 'cancelled') setNote(null);
    else if (outcome === 'failed') setNote(t('trip.viewer.downloadFailed'));
    else setNote(outcome === 'shared' ? t('trip.viewer.saved') : t('settings.trackFiles.saved'));
  }

  // The note clears itself; a photo you page away from takes it with you.
  useEffect(() => {
    if (!note || saving) return;
    const timer = window.setTimeout(() => setNote(null), 2600);
    return () => window.clearTimeout(timer);
  }, [note, saving]);

  useEffect(() => {
    setNote(null);
  }, [item?.id]);

  // Public Immich URL, for the deep link to the asset. Only for own photos;
  // friends' photos live on their server.
  useEffect(() => {
    if (isPublic) return; // nothing to deep-link to, and no session to ask with
    api<ConnectionStatus>('/immich/connection')
      .then((s) => setImmichUrl(s.publicUrl ?? DEFAULT_IMMICH_PUBLIC_URL))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) setImmichUrl(DEFAULT_IMMICH_PUBLIC_URL);
      });
  }, [isPublic]);

  /** The menu for one photo: the one on screen, or one either side of it. */
  const actionsFor = (target: MediaItem | undefined): ViewerAction[] => {
    const actions: ViewerAction[] = [];
    if (!target) return actions;
    const onDevice = isDeviceMediaId(target.id);
    const isOwn = !isPublic && target.userId === userId;

    if (coverTripId && !onDevice) {
      const done = coverSaved === target.id;
      actions.push({
        id: 'cover',
        label: done ? t('trip.viewer.coverSet') : t('trip.viewer.asCover'),
        icon: done ? 'check' : 'camera',
        symbol: done ? 'checkmark' : 'photo',
        run: () => void setAsCover(target),
      });
    }
    // The tile at the top of the timeline that takes you to this place: this
    // is where you choose which photo it wears.
    const stop = stopCoverFor && !onDevice ? stopCoverFor(target) : null;
    if (stop && onSetStopCover) {
      const done = stopCoverSaved === target.id;
      actions.push({
        id: 'stopCover',
        label: done
          ? t('trip.viewer.stopCoverSet')
          : t('trip.viewer.stopCover', { name: legTitle(stop.name) }),
        icon: done ? 'check' : 'pin',
        symbol: done ? 'checkmark' : 'mappin.and.ellipse',
        run: () => void setAsStopCover(target, stop.id),
      });
    }
    // Every viewer gets this one, the share page included: whoever is looking
    // at the photo may as well be able to keep it. A photo that never left
    // this phone is already in its gallery, so there is nothing to download.
    if (!onDevice) {
      actions.push({
        id: 'download',
        label:
          saving === target.id
            ? t('trip.viewer.downloading')
            : target.assetType === 'VIDEO'
              ? t('trip.viewer.downloadVideo')
              : t('trip.viewer.downloadPhoto'),
        icon: 'download',
        symbol: 'square.and.arrow.down',
        run: () => void saveToDevice(target),
      });
    }
    if (isOwn && immichUrl && !onDevice) {
      actions.push({
        id: 'immich',
        label: t('trip.viewer.openInImmich'),
        icon: 'external',
        symbol: 'arrow.up.right.square',
        run: () => openExternal(`${immichUrl}/photos/${target.immichAssetId}`),
      });
    }
    return actions;
  };

  return { actionsFor, note, saving: saving !== null };
}

/**
 * City and country for a photo, when it carries a coordinate. Cached per ~1 km
 * by the geocoder, so paging through an album does not ask it again.
 *
 * The name is NOT cleared between photos. Twenty shots taken in one town all
 * resolve to that town, and blanking the line in between made it fade itself
 * back in twenty times over. It changes when the place changes, and only then.
 */
export function usePlaceName(
  item: MediaItem | undefined,
  fallbackFor?: (item: MediaItem) => string | null,
): string | null {
  const [place, setPlace] = useState<string | null>(null);
  const fallbackRef = useRef(fallbackFor);
  fallbackRef.current = fallbackFor;

  useEffect(() => {
    const lat = item?.latitude;
    const lon = item?.longitude;
    if (lat == null || lon == null) {
      setPlace(null);
      return;
    }
    let alive = true;
    const known = item ? fallbackRef.current?.(item) ?? null : null;
    void reversePlaceName(lat, lon).then((name) => alive && setPlace(name ?? known));
    return () => {
      alive = false;
    };
    // The fallback is read through a ref: it is rebuilt on every render of the
    // page above, and depending on it would re-ask the geocoder each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.latitude, item?.longitude]);

  return place;
}

/**
 * The place names of a few photos at once, for the native viewer, which has
 * the photos either side of the one on screen ready with their captions.
 */
export function usePlaceNames(
  list: MediaItem[],
  fallbackFor?: (item: MediaItem) => string | null,
): Record<string, string | null> {
  const [places, setPlaces] = useState<Record<string, string | null>>({});
  const known = useRef(places);
  known.current = places;
  const fallbackRef = useRef(fallbackFor);
  fallbackRef.current = fallbackFor;
  const key = list.map((item) => item.id).join(',');

  useEffect(() => {
    for (const item of list) {
      const lat = item.latitude;
      const lon = item.longitude;
      if (item.id in known.current || lat == null || lon == null) continue;
      const fallback = fallbackRef.current?.(item) ?? null;
      void reversePlaceName(lat, lon).then((name) =>
        setPlaces((p) => ({ ...p, [item.id]: name ?? fallback })),
      );
    }
    // The list is rebuilt on every render; the photos in it are `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return places;
}
