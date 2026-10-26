import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useExit } from '../lib/useExit';
import { Icon } from './Icon';
import { t } from '../i18n';
import './photoreactions.css';

/** The five a photo can get, in the order the picker shows them. */
export const REACTIONS = [
  { kind: 'heart', emoji: '❤️', label: t('social.reactions.heart') },
  { kind: 'laugh', emoji: '😂', label: t('social.reactions.laugh') },
  { kind: 'wow', emoji: '😮', label: t('social.reactions.wow') },
  { kind: 'love', emoji: '😍', label: t('social.reactions.love') },
  { kind: 'clap', emoji: '👏', label: t('social.reactions.clap') },
] as const;

const EMOJI: Record<string, string> = Object.fromEntries(REACTIONS.map((r) => [r.kind, r.emoji]));

/** Targets: a photo by its media id, a comment as `c:<comment id>`. */
export interface ReactionsView {
  counts: { target: string; kind: string; count: number }[];
  mine: Record<string, string>;
  names?: Record<string, { kind: string; name: string }[]>;
}

export interface ReactionsAdapter {
  /** How many of each on a photo or comment, most first. */
  summary: (target: string) => { kind: string; count: number }[];
  /** The viewer's own pick. */
  mine: (target: string) => string | null;
  /** Who reacted, when the server tells (the app, not the share page). */
  names: (target: string) => { kind: string; name: string }[];
  set: (target: string, kind: string | null) => Promise<void>;
}

/** A comment as a reaction target. */
export const commentTarget = (commentId: string) => `c:${commentId}`;

/** This browser's key on the share page: who a visitor is, for their likes. */
export function reactorKey(): string {
  try {
    const stored = localStorage.getItem('mms.reactor');
    if (stored) return stored;
  } catch {
    // Falls through to a key for this visit only.
  }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const key = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  try {
    localStorage.setItem('mms.reactor', key);
  } catch {
    // A private window: the hearts last as long as the visit.
  }
  return key;
}

/**
 * The trip's reactions, kept in state and changed optimistically: a tap shows
 * at once, and is put back if the server says no.
 */
export function useReactions(
  load: () => Promise<ReactionsView>,
  put: (target: string, kind: string | null) => Promise<void>,
): ReactionsAdapter {
  const [view, setView] = useState<ReactionsView>({ counts: [], mine: {} });

  useEffect(() => {
    load().then(setView).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byMedia = useMemo(() => {
    const map = new Map<string, { kind: string; count: number }[]>();
    for (const c of view.counts) {
      if (c.count <= 0) continue;
      const list = map.get(c.target) ?? [];
      list.push({ kind: c.kind, count: c.count });
      map.set(c.target, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.count - a.count);
    return map;
  }, [view.counts]);

  const set = useCallback(
    async (target: string, kind: string | null) => {
      const before = view;
      setView((v) => applyPick(v, target, kind));
      try {
        await put(target, kind);
      } catch {
        setView(before);
      }
    },
    [view, put],
  );

  return useMemo(
    () => ({
      summary: (id) => byMedia.get(id) ?? [],
      mine: (id) => view.mine[id] ?? null,
      names: (id) => view.names?.[id] ?? [],
      set,
    }),
    [byMedia, view, set],
  );
}

/** The counts as they are after one person swaps, adds or drops their pick. */
function applyPick(v: ReactionsView, target: string, kind: string | null): ReactionsView {
  const old = v.mine[target] ?? null;
  const counts = v.counts.map((c) => ({ ...c }));
  const bump = (k: string, by: number) => {
    const row = counts.find((c) => c.target === target && c.kind === k);
    if (row) row.count += by;
    else if (by > 0) counts.push({ target, kind: k, count: by });
  };
  if (old) bump(old, -1);
  if (kind) bump(kind, 1);
  const mine = { ...v.mine };
  if (kind) mine[target] = kind;
  else delete mine[target];
  return { ...v, counts, mine };
}

/** On a grid photo: the most-given emoji and how many in all. */
export function ReactionBadge({ summary }: { summary: { kind: string; count: number }[] }) {
  if (summary.length === 0) return null;
  const total = summary.reduce((sum, r) => sum + r.count, 0);
  return (
    <span className="reaction-badge" aria-label={t('social.reactions.likes', { count: total })}>
      {summary.slice(0, 2).map((r) => (
        <span key={r.kind}>{EMOJI[r.kind]}</span>
      ))}
      <span className="reaction-badge-count">{total}</span>
    </span>
  );
}

/**
 * In the viewer, bottom left: a like button. A tap opens the five to choose
 * from; the button then shows your own pick, and the total beside it. Tapping
 * your own pick again takes it away.
 *
 * Open or shut is the viewer's to hold (`open`, `onOpenChange`), so its back
 * gesture can close the picker before it closes the photo.
 */
export function ReactionBar({
  mediaId,
  adapter,
  open,
  onOpenChange,
}: {
  mediaId: string;
  adapter: ReactionsAdapter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [shown, closing] = useExit(open, 180);
  const barRef = useRef<HTMLDivElement>(null);
  const mine = adapter.mine(mediaId);
  const summary = adapter.summary(mediaId);
  const names = adapter.names(mediaId);
  const total = summary.reduce((sum, r) => sum + r.count, 0);

  // Another photo: the picker closes rather than hovering over the wrong one.
  useEffect(() => onOpenChange(false), [mediaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tap anywhere else closes it, as a popover does.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open, onOpenChange]);

  const pick = (kind: string) => {
    onOpenChange(false);
    void adapter.set(mediaId, kind === mine ? null : kind);
  };

  return (
    <div className="reaction-bar" ref={barRef} onClick={(e) => e.stopPropagation()}>
      {shown && (
        <div className={`reaction-picker ${closing ? 'closing' : ''}`} role="menu">
          {REACTIONS.map((r) => (
            <button
              key={r.kind}
              type="button"
              role="menuitem"
              aria-label={r.label}
              title={r.label}
              className={mine === r.kind ? 'on' : ''}
              onClick={() => pick(r.kind)}
            >
              {r.emoji}
            </button>
          ))}
          {names.length > 0 && (
            <p className="reaction-names">
              {names.map((n) => `${EMOJI[n.kind] ?? ''} ${n.name}`).join(' · ')}
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        className={`reaction-toggle ${mine ? 'has' : ''}`}
        aria-label={mine ? t('social.reactions.change') : t('social.reactions.like')}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {mine ? (
          <span className="reaction-toggle-emoji" key={mine}>
            {EMOJI[mine]}
          </span>
        ) : (
          <Icon name="heart" size={20} />
        )}
        {total > 0 && <span className="reaction-toggle-count">{total}</span>}
      </button>
    </div>
  );
}

/**
 * Under a comment: one like, a heart and how many. Nothing to choose from: a
 * comment is liked or it is not.
 */
export function CommentReactions({ target, adapter }: { target: string; adapter: ReactionsAdapter }) {
  const mine = adapter.mine(target);
  const total = adapter.summary(target).reduce((sum, r) => sum + r.count, 0);
  const names = adapter
    .names(target)
    .map((n) => n.name)
    .join(', ');

  return (
    <div className="comment-reactions">
      <button
        type="button"
        className={`comment-like ${mine ? 'on' : ''}`}
        aria-pressed={!!mine}
        aria-label={mine ? t('social.reactions.unlike') : t('social.reactions.like')}
        title={names || undefined}
        onClick={() => void adapter.set(target, mine ? null : 'heart')}
      >
        <Icon name="heart" size={14} key={mine ? 'on' : 'off'} />
        {total > 0 && <span>{total}</span>}
      </button>
    </div>
  );
}
