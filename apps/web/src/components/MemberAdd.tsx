import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import './memberadd.css';

export interface UserSuggestion {
  id: string;
  username: string;
  displayName: string;
  hasAvatar: boolean;
  sharedTrips: number;
}

/**
 * Tick the people who came along, add them in one go.
 *
 * The list is part of the page rather than a menu floating over it: a dropdown
 * landed on top of the rows below and was hard to read, and it only ever
 * offered one name per search — four reisgenoten meant four lookups.
 */
export function MemberAdd({
  exclude,
  busy,
  onAdd,
}: {
  /** Usernames already on the trip: offering them again is noise. */
  exclude: string[];
  busy: boolean;
  onAdd: (usernames: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<UserSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<UserSuggestion[]>([]);

  // Debounced, so typing doesn't fire a request per keystroke.
  useEffect(() => {
    setLoading(true);
    const t = window.setTimeout(
      () => {
        api<UserSuggestion[]>(
          `/users/suggestions?limit=25&q=${encodeURIComponent(query.trim())}`,
        )
          .then(setItems)
          .catch(() => setItems([]))
          .finally(() => setLoading(false));
      },
      query ? 220 : 0,
    );
    return () => window.clearTimeout(t);
  }, [query]);

  const isPicked = (u: UserSuggestion) => picked.some((p) => p.id === u.id);

  const toggle = (u: UserSuggestion) => {
    setPicked((list) => (list.some((p) => p.id === u.id) ? list.filter((p) => p.id !== u.id) : [...list, u]));
  };

  const visible = items.filter((u) => !exclude.includes(u.username));
  // Someone you ticked and then searched past keeps a chip, so a new search
  // never quietly loses a choice you already made. People still in the list
  // below don't need one: their row already says it.
  const offscreen = picked.filter((p) => !visible.some((v) => v.id === p.id));

  async function submit() {
    if (picked.length === 0) return;
    await onAdd(picked.map((p) => p.username));
    setPicked([]);
    setQuery('');
  }

  return (
    <div className="member-add">
      <div className="member-add-search">
        <Icon name="search" size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek op naam of @gebruikersnaam"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button type="button" className="member-add-clear" onClick={() => setQuery('')} aria-label="Wissen">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {offscreen.length > 0 && (
        <div className="member-add-chips">
          {offscreen.map((u) => (
            <button key={u.id} type="button" className="member-add-chip" onClick={() => toggle(u)}>
              <Avatar userId={u.id} displayName={u.displayName} hasAvatar={u.hasAvatar} size={20} />
              {u.displayName}
              <Icon name="close" size={12} />
            </button>
          ))}
        </div>
      )}

      <div className="member-add-list">
        {visible.map((u, i) => (
          <button
            key={u.id}
            type="button"
            className={`member-add-row ${isPicked(u) ? 'checked' : ''}`}
            aria-pressed={isPicked(u)}
            // Rows that survive a new search keep their place and do not
            // re-animate; the ones that just arrived come in one after another.
            style={{ animationDelay: `${Math.min(i, 7) * 28}ms` }}
            onClick={() => toggle(u)}
          >
            <span className="member-add-box" aria-hidden="true">
              {isPicked(u) && <Icon name="check" size={12} />}
            </span>
            <Avatar userId={u.id} displayName={u.displayName} hasAvatar={u.hasAvatar} size={28} />
            <span className="member-add-name">
              {u.displayName}
              <small>@{u.username}</small>
            </span>
            {u.sharedTrips > 0 && (
              <span className="member-add-tag">
                {u.sharedTrips} {u.sharedTrips === 1 ? 'reis' : 'reizen'}
              </span>
            )}
          </button>
        ))}
        {visible.length === 0 && (
          <p className="muted member-add-empty">
            {loading
              ? 'Zoeken…'
              : query
                ? 'Niemand gevonden met die naam.'
                : picked.length > 0
                  ? 'Zoek op naam om er meer toe te voegen.'
                  : 'Zoek op naam of @gebruikersnaam om iemand toe te voegen.'}
          </p>
        )}
      </div>

      <button
        type="button"
        className="btn btn-ghost member-add-submit"
        disabled={busy || picked.length === 0}
        onClick={() => void submit()}
      >
        <Icon name="plus" size={16} />
        {picked.length > 1 ? `${picked.length} mensen toevoegen` : 'Toevoegen'}
      </button>
    </div>
  );
}
