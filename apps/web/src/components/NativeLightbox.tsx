import { useEffect, useRef } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { api, ApiError, getAccessToken, getServerBase, tryRefresh } from '../api/client';
import type { MediaItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDay } from '../lib/colors';
import { deviceMediaUri, isDeviceMediaId } from '../lib/deviceMedia';
import { toBase64 } from '../lib/fileShare';
import { isLocalMode } from '../lib/localMode';
import {
  MmsViewer,
  setNativeViewerOpen,
  type NativeViewerItem,
  type NativeViewerLabels,
  type NativeViewerState,
} from '../lib/nativeViewer';
import { loadImage } from './AuthImage';
import type { LightboxProps } from './Lightbox';
import { commentTime } from './PhotoComments';
import { commentTarget, REACTIONS } from './PhotoReactions';
import { usePlaceNames, useViewerTools } from './viewerTools';
import { t } from '../i18n';

const ASSET_PREFIX = 'mmsphoto://asset/';

/** The Photos asset behind a photo that never left this phone, if it is one. */
function photosAsset(item: MediaItem): string | undefined {
  let uri: string | null = null;
  if (isDeviceMediaId(item.id)) uri = deviceMediaUri(item.id);
  else if (isLocalMode()) {
    try {
      uri = decodeURIComponent(item.id);
    } catch {
      uri = null;
    }
  }
  if (!uri?.startsWith(ASSET_PREFIX)) return undefined;
  return decodeURIComponent(uri.slice(ASSET_PREFIX.length).split('?')[0]!);
}

function toNative(item: MediaItem): NativeViewerItem {
  const lowPath = `/media/${item.id}/thumbnail?size=thumbnail`;
  const fullPath = `/media/${item.id}/thumbnail`;
  const native: NativeViewerItem = {
    id: item.id,
    video: item.assetType === 'VIDEO',
    ratio: item.width && item.height ? item.width / item.height : undefined,
  };
  const asset = photosAsset(item);
  if (asset) return { ...native, asset };
  // Without a server only the page knows where a photo is; the viewer asks.
  if (isLocalMode() || isDeviceMediaId(item.id)) return { ...native, lowPath, fullPath };
  const base = `${getServerBase()}/api`;
  return { ...native, low: base + lowPath, full: base + fullPath, lowPath, fullPath };
}

function viewerLabels(): NativeViewerLabels {
  return {
    close: t('common.close'),
    more: t('common.more'),
    comments: t('trip.viewer.comments'),
    commentsClose: t('social.comments.close'),
    placeholder: t('social.comments.placeholder'),
    post: t('social.comments.post'),
    delete: t('common.delete'),
    empty: t('social.comments.empty'),
    traveller: t('social.comments.traveller'),
    videoLoading: t('trip.viewer.videoLoading'),
    like: t('social.reactions.like'),
    unlike: t('social.reactions.unlike'),
    change: t('social.reactions.change'),
    reactions: REACTIONS.map((r) => ({ kind: r.kind, emoji: r.emoji, label: r.label })),
  };
}

const emojiOf = (kind: string) => REACTIONS.find((r) => r.kind === kind)?.emoji ?? '';
const token = () => getAccessToken() ?? undefined;

/**
 * The photo viewer on the iPhone, drawn by the app itself (PhotoViewer.swift).
 *
 * This renders nothing. It opens the native viewer with the photos, keeps it
 * told about the one on screen and the ones either side (caption, menu,
 * comments, likes), and answers what happens there the way the viewer on the
 * page would: the same menu actions, the same comment and like calls.
 */
export function NativeLightbox({
  items,
  index,
  onClose,
  onNavigate,
  coverTripId,
  onCoverSet,
  stopCoverFor,
  onSetStopCover,
  placeFallbackFor,
  comments,
  startWithComments = false,
  reactions,
}: LightboxProps) {
  const { user } = useAuth();
  const item = items[index];
  const tools = useViewerTools({ item, userId: user?.id, coverTripId, onCoverSet, stopCoverFor, onSetStopCover });
  // The one on screen first, then where a swipe goes next.
  const near = [items[index], items[index + 1], items[index - 1]].filter((m): m is MediaItem => Boolean(m));
  const places = usePlaceNames(near, placeFallbackFor);

  const stateFor = (media: MediaItem): NativeViewerState => {
    const onDevice = isDeviceMediaId(media.id);
    const state: NativeViewerState = {
      id: media.id,
      title: formatDay(media.takenAt),
      subtitle: places[media.id] ?? undefined,
      actions: tools.actionsFor(media).map((a) => ({ id: a.id, title: a.label, symbol: a.symbol })),
    };
    // A photo that never left this phone has nobody else looking at it.
    if (comments && !onDevice) {
      const list = comments.list({ mediaId: media.id });
      const likes = comments.reactions ?? reactions;
      state.comments = {
        title:
          list.length === 0 ? t('social.comments.title') : t('social.comments.count', { count: list.length }),
        button: list.length > 0 ? String(list.length) : t('trip.viewer.comment'),
        list: list.map((c) => {
          const target = commentTarget(c.id);
          return {
            id: c.id,
            name: c.authorName,
            traveller: c.traveller,
            time: commentTime(c.createdAt),
            body: c.body,
            canDelete: Boolean(c.canDelete && comments.remove),
            likes: likes?.summary(target).reduce((sum, r) => sum + r.count, 0) ?? 0,
            liked: Boolean(likes?.mine(target)),
            likedBy: likes?.names(target).map((n) => n.name).join(', ') ?? '',
          };
        }),
      };
    }
    if (reactions && !onDevice) {
      state.reactions = {
        mine: reactions.mine(media.id),
        total: reactions.summary(media.id).reduce((sum, r) => sum + r.count, 0),
        names: reactions
          .names(media.id)
          .map((n) => `${emojiOf(n.kind)} ${n.name}`)
          .join(' · '),
      };
    }
    return state;
  };
  const states = near.map(stateFor);

  // Everything the viewer's events need, as of this render: they are listened
  // to once, for as long as the viewer is open.
  const live = useRef({ items, onClose, onNavigate, comments, reactions, tools, states });
  live.current = { items, onClose, onNavigate, comments, reactions, tools, states };

  const ready = useRef(false);
  /** The photo the viewer says it is on: the page agreeing with it is not news. */
  const shown = useRef(index);
  const sentIds = useRef(items.map((m) => m.id).join('\n'));
  /** What each photo's state was when it was last sent, so only changes go. */
  const sent = useRef(new Map<string, string>());

  const sendStates = () => {
    for (const state of live.current.states) {
      const json = JSON.stringify(state);
      if (sent.current.get(state.id) === json) continue;
      sent.current.set(state.id, json);
      void MmsViewer.state({ ...state, token: token() });
    }
  };

  useEffect(() => {
    let alive = true;
    const find = (id: string) => live.current.items.find((m) => m.id === id);

    async function post(id: string, body: string, request: string) {
      const adapter = live.current.comments;
      try {
        if (!adapter) throw new Error('no comments');
        await adapter.post({ mediaId: id }, body);
        await MmsViewer.result({ request });
      } catch (err) {
        const tooFast =
          (err instanceof ApiError && err.status === 429) || (err instanceof Error && err.message === '429');
        await MmsViewer.result({
          request,
          error: tooFast ? t('social.comments.tooFast') : t('social.comments.sendFailed'),
        });
      }
    }

    async function remove(commentId: string, request: string) {
      const adapter = live.current.comments;
      const comment = live.current.items
        .flatMap((m) => adapter?.list({ mediaId: m.id }) ?? [])
        .find((c) => c.id === commentId);
      try {
        if (!adapter?.remove || !comment) throw new Error('not found');
        await adapter.remove(comment);
        await MmsViewer.result({ request });
      } catch {
        await MmsViewer.result({ request, error: t('social.comments.deleteFailed') });
      }
    }

    async function playback(id: string) {
      try {
        const res = await api<{ url: string }>(`/media/${id}/video-url`);
        await MmsViewer.video({ id, url: `${getServerBase()}${res.url}` });
      } catch {
        // The still stays up with its word that the video is coming, as it
        // does in the viewer on the page.
      }
    }

    /**
     * The bytes of a photo the viewer could not fetch itself: offline, from
     * the page's cache, or with a token that ran out, after the page has
     * refreshed its session. Only the page refreshes: two of them trading in
     * the same refresh token would sign the user out.
     */
    async function image(key: string, path: string) {
      try {
        let url: string;
        try {
          url = await loadImage(path);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 401)) throw err;
          if ((await tryRefresh()) !== 'ok') throw err;
          url = await loadImage(path);
        }
        const blob = await (await fetch(url)).blob();
        await MmsViewer.image({ key, base64: await toBase64(blob), token: token() });
      } catch {
        await MmsViewer.image({ key, token: token() }).catch(() => undefined);
      }
    }

    const handles: Promise<PluginListenerHandle>[] = [
      MmsViewer.addListener('index', (e) => {
        shown.current = e.index;
        live.current.onNavigate(e.index);
      }),
      MmsViewer.addListener('closed', () => {
        setNativeViewerOpen(false);
        live.current.onClose();
      }),
      MmsViewer.addListener('action', (e) => {
        const media = find(e.id);
        live.current.tools.actionsFor(media).find((a) => a.id === e.action)?.run();
      }),
      MmsViewer.addListener('react', (e) => {
        const { comments: c, reactions: r } = live.current;
        const adapter = e.target.startsWith('c:') ? (c?.reactions ?? r) : r;
        void adapter?.set(e.target, e.kind);
      }),
      MmsViewer.addListener('post', (e) => void post(e.id, e.body, e.request)),
      MmsViewer.addListener('remove', (e) => void remove(e.comment, e.request)),
      MmsViewer.addListener('video', (e) => void playback(e.id)),
      MmsViewer.addListener('image', (e) => void image(e.key, e.path)),
    ];

    void Promise.all(handles)
      .then(() => {
        if (!alive) return;
        setNativeViewerOpen(true);
        return MmsViewer.open({
          items: live.current.items.map(toNative),
          index,
          labels: viewerLabels(),
          startWithComments,
          token: token(),
        }).then(() => {
          if (!alive) return;
          ready.current = true;
          sendStates();
        });
      })
      .catch(() => {
        // Nothing opened: the page's own viewer is not there either, so the
        // tap that asked for it simply did nothing.
        setNativeViewerOpen(false);
        if (alive) live.current.onClose();
      });

    return () => {
      alive = false;
      ready.current = false;
      setNativeViewerOpen(false);
      void Promise.all(handles).then((list) => list.forEach((h) => void h.remove()));
      void MmsViewer.close();
    };
    // Opened once; what changes after that is sent by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The album or the photo changed from the page's side (a photo added or
  // taken away, a map pin opening another one): the viewer follows.
  const ids = items.map((m) => m.id).join('\n');
  useEffect(() => {
    if (!ready.current) return;
    if (ids === sentIds.current && index === shown.current) return;
    sentIds.current = ids;
    shown.current = index;
    void MmsViewer.items({ items: items.map(toNative), index });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, index]);

  const statesKey = JSON.stringify(states);
  useEffect(() => {
    if (ready.current) sendStates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statesKey]);

  useEffect(() => {
    if (!ready.current) return;
    void MmsViewer.note({ text: tools.note ?? undefined, busy: tools.saving });
  }, [tools.note, tools.saving]);

  return null;
}
