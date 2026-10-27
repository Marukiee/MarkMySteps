import { FormEvent, useEffect, useRef, useState } from 'react';
import { useExit } from '../lib/useExit';
import type { PhotoComment } from '../api/types';
import { Icon } from './Icon';
import { CommentReactions, commentTarget, ReactionsAdapter } from './PhotoReactions';
import { intlLocale, t } from '../i18n';
import './photocomments.css';

/**
 * What a viewer needs to show and write comments. The share page and the app
 * each hand in their own: the share page asks visitors for a name and talks to
 * the link's endpoints, the app knows who you are and may take comments away.
 */
export interface PhotoCommentsAdapter {
  /** The comments on one photo or one day, oldest first. */
  list: (target: CommentTarget) => PhotoComment[];
  /** A visitor has no account, so they type the name the comment goes under. */
  askName: boolean;
  post: (target: CommentTarget, body: string, name?: string) => Promise<void>;
  remove?: (comment: PhotoComment) => Promise<void>;
  /** Emoji on each comment, when this page has them. */
  reactions?: ReactionsAdapter;
}

/** What a thread is about: one photo, or one day's story. */
export type CommentTarget = { mediaId: string } | { day: string };

const targetKey = (t: CommentTarget) => ('mediaId' in t ? `m:${t.mediaId}` : `d:${t.day}`);

/** A trip's comments sorted into threads, for the flags and the counts. */
export function groupComments(comments: PhotoComment[]) {
  const byMedia = new Map<string, PhotoComment[]>();
  const byDay = new Map<string, PhotoComment[]>();
  for (const c of comments) {
    const map = c.mediaId ? byMedia : byDay;
    const key = c.mediaId ?? c.day;
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  }
  const list = (t: CommentTarget) =>
    ('mediaId' in t ? byMedia.get(t.mediaId) : byDay.get(t.day)) ?? [];
  return { byMedia, byDay, list };
}

const NAME_KEY = 'mms.commentName';

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // A private window: the name is simply asked for again next time.
  }
}

const when = new Intl.DateTimeFormat(intlLocale(), {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** When a comment was written, as the thread shows it. */
export function commentTime(iso: string): string {
  return when.format(new Date(iso));
}

/** The flag on a photo in the grid that has comments under it. */
export function CommentFlag({ count, onOpen }: { count: number; onOpen?: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      className="comment-flag"
      aria-label={t('social.comments.count', { count })}
      onClick={(e) => {
        // Straight to the conversation, not just to the photo.
        e.stopPropagation();
        onOpen?.();
      }}
    >
      <Icon name="comment" size={13} />
      {count}
    </button>
  );
}

/**
 * A thread of comments with the box to add one: as a dark sheet over the
 * photo in the viewer, or inline under a day's story on the page.
 */
export function PhotoCommentsPanel({
  target,
  adapter,
  onClose,
  variant = 'sheet',
  closing = false,
}: {
  target: CommentTarget;
  adapter: PhotoCommentsAdapter;
  onClose: () => void;
  variant?: 'sheet' | 'inline';
  /** On its way out: plays the reverse of the way it came in. */
  closing?: boolean;
}) {
  const comments = adapter.list(target);
  const key = targetKey(target);
  const [name, setName] = useState(rememberedName);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Another photo, another conversation: a half-written comment stays with
  // the photo it was meant for by not following you to the next one.
  useEffect(() => {
    setBody('');
    setError(null);
  }, [key]);

  // The newest is at the bottom, next to the box you just wrote it in.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [comments.length, key]);

  const canSend = body.trim().length > 0 && (!adapter.askName || name.trim().length > 0) && !busy;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const typed = adapter.askName ? name.trim() : undefined;
      await adapter.post(target, body.trim(), typed);
      if (typed) rememberName(typed);
      setBody('');
    } catch (err) {
      setError(
        err instanceof Error && err.message === '429'
          ? t('social.comments.tooFast')
          : t('social.comments.sendFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(comment: PhotoComment) {
    if (!adapter.remove) return;
    try {
      await adapter.remove(comment);
    } catch {
      setError(t('social.comments.deleteFailed'));
    }
  }

  return (
    <section
      className={`photo-comments ${variant === 'inline' ? 'inline' : ''} ${closing ? 'closing' : ''}`}
      aria-label={t('social.comments.title')}
      // The viewer closes on a tap anywhere outside the photo; this is not
      // outside the photo as far as anybody reading it is concerned.
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <header className="photo-comments-head">
        <strong>
          {comments.length === 0
            ? t('social.comments.title')
            : t('social.comments.count', { count: comments.length })}
        </strong>
        <button type="button" aria-label={t('social.comments.close')} onClick={onClose}>
          <Icon name={variant === 'inline' ? 'chevron-up' : 'chevron-down'} size={20} />
        </button>
      </header>

      {comments.length === 0 ? (
        variant === 'sheet' && (
          <p className="photo-comments-empty">{t('social.comments.empty')}</p>
        )
      ) : (
        <ol className="photo-comments-list" ref={listRef}>
          {comments.map((c) => (
            <li key={c.id}>
              <div className="photo-comments-meta">
                <span className="photo-comments-name">{c.authorName}</span>
                {c.traveller && <span className="photo-comments-badge">{t('social.comments.traveller')}</span>}
                <time dateTime={c.createdAt}>{when.format(new Date(c.createdAt))}</time>
                {c.canDelete && adapter.remove && (
                  <button
                    type="button"
                    className="photo-comments-delete"
                    aria-label={t('social.comments.delete')}
                    onClick={() => void remove(c)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
              <p className="photo-comments-body">{c.body}</p>
              {adapter.reactions && (
                <CommentReactions target={commentTarget(c.id)} adapter={adapter.reactions} />
              )}
            </li>
          ))}
        </ol>
      )}

      <form className="photo-comments-form" onSubmit={submit}>
        {adapter.askName && (
          <input
            type="text"
            className="photo-comments-name-input"
            placeholder={t('social.comments.yourName')}
            autoComplete="name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        <div className="photo-comments-compose">
          <textarea
            placeholder={t('social.comments.placeholder')}
            rows={1}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a new line, as in any chat.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <button type="submit" disabled={!canSend} aria-label={t('social.comments.send')}>
            {busy ? '…' : t('social.comments.post')}
          </button>
        </div>
        {error && (
          <p className="photo-comments-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

/**
 * Under a day's story: a clear "Reageer" button with the count, and the
 * thread opening in place underneath it.
 */
export function DayComments({
  day,
  adapter,
  startOpen = false,
}: {
  day: string;
  adapter: PhotoCommentsAdapter;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  // Folds back up before the button returns, instead of swapping in one frame.
  const [shown, closing] = useExit(open, 200);
  const ref = useRef<HTMLDivElement>(null);
  const comments = adapter.list({ day });
  const last = comments[comments.length - 1];

  // Opened from a link to this day (?dag=): bring it into view.
  useEffect(() => {
    if (startOpen) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [startOpen]);

  return (
    <div className="day-comments" ref={ref}>
      {shown ? (
        <PhotoCommentsPanel
          target={{ day }}
          adapter={adapter}
          variant="inline"
          closing={closing}
          onClose={() => setOpen(false)}
        />
      ) : (
        <>
          {last && (
            <p className="day-comment-preview">
              <strong>{last.authorName}</strong>: {last.body.length > 90 ? `${last.body.slice(0, 90)}…` : last.body}
            </p>
          )}
          <button type="button" className="btn btn-ghost day-comment-btn" onClick={() => setOpen(true)}>
            <Icon name="comment" size={14} />
            {t('social.comments.reply')}
            {comments.length > 0 && <span className="day-comment-count">{comments.length}</span>}
          </button>
        </>
      )}
    </div>
  );
}
