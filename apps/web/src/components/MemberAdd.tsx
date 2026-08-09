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
  onAdd: (usernames: string[], role: 'MEMBER' | 'GUEST') => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<UserSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<UserSuggestion[]>([]);
  // Someone you just unpicked stays in the list for the length of its exit
  // animation, so the chip shrinks away and the ones after it slide across
  // rather than snapping into the hole.
  const [leaving, setLeaving] = useState<string[]>([]);
  /**
   * The chip row shutting itself before the last chip is taken out of it.
   *
   * A grid row of 1fr is as tall as what is in it, so unmounting the chip and
   * asking the row to close in the same frame is a transition from nothing to
   * nothing: the row snapped shut and everything below it jumped up. Closing
   * first, while the (already faded) chip still holds the height open, is what
   * gives the collapse something to animate.
   */
  const [collapsing, setCollapsing] = useState(false);

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

  // Everyone who is on their way out is already unpicked as far as the rest of
  // the component is concerned: the row's ring drops immediately, only the
  // chip lingers.
  const active = picked.filter((p) => !leaving.includes(p.id));
  const isPicked = (u: UserSuggestion) => active.some((p) => p.id === u.id);

  /** Chips out, then the row shut, then the row emptied. */
  const clearRow = () => {
    setCollapsing(true);
    window.setTimeout(() => {
      setPicked([]);
      setLeaving([]);
      setCollapsing(false);
    }, 280);
  };

  const unpick = (id: string) => {
    const last = active.length === 1 && active[0]!.id === id;
    setLeaving((list) => [...list, id]);
    window.setTimeout(() => {
      if (last) {
        clearRow();
        return;
      }
      setPicked((list) => list.filter((p) => p.id !== id));
      setLeaving((list) => list.filter((x) => x !== id));
    }, 220);
  };

  const toggle = (u: UserSuggestion) => {
    if (isPicked(u)) unpick(u.id);
    else setPicked((list) => (list.some((p) => p.id === u.id) ? list : [...list, u]));
  };

  // The list is part of the sheet rather than a box that scrolls on its own,
  // so it shows a handful and lets the search narrow it down from there.
  const visible = items.filter((u) => !exclude.includes(u.username)).slice(0, query ? 12 : 8);

  async function submit(role: 'MEMBER' | 'GUEST') {
    if (active.length === 0) return;
    await onAdd(active.map((p) => p.username), role);
    // Same way out as unpicking the last one: the row closes rather than the
    // whole panel jumping a chip's worth.
    setLeaving(active.map((p) => p.id));
    clearRow();
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

      {/* Everyone you have ticked, whether or not their row is still on screen.
          A running total under the search box is the only place that survives
          a new search, and it is where you go to take somebody back off.

          The row is always in the page and opens to the height it needs, so the
          first person you tick makes the list below slide down rather than jump
          a chip's worth in one frame. */}
      <div className="member-add-chips-wrap" data-open={picked.length > 0 && !collapsing}>
        <div className="member-add-chips">
          {picked.map((u) => (
            <button
              key={u.id}
              type="button"
              className={`member-add-chip ${leaving.includes(u.id) ? 'leaving' : ''}`}
              aria-label={`${u.displayName} niet toevoegen`}
              onClick={() => unpick(u.id)}
            >
              <Avatar userId={u.id} displayName={u.displayName} hasAvatar={u.hasAvatar} size={20} />
              {u.displayName}
              <Icon name="close" size={12} />
            </button>
          ))}
        </div>
      </div>

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
                : active.length > 0
                  ? 'Zoek op naam om er meer toe te voegen.'
                  : 'Zoek op naam of @gebruikersnaam om iemand toe te voegen.'}
          </p>
        )}
      </div>

      {/* The role is part of adding somebody, not a correction you make in the
          list afterwards, so it is the button you press rather than a switch
          above it. */}
      <div className="member-add-as">
        <span className="member-add-as-label">
          {active.length > 1 ? `${active.length} mensen toevoegen als` : 'Toevoegen als'}
        </span>
        <div className="member-add-as-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || active.length === 0}
            onClick={() => void submit('MEMBER')}
          >
            <Icon name="plus" size={16} />
            Reisgenoot
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || active.length === 0}
            onClick={() => void submit('GUEST')}
          >
            <Icon name="plus" size={16} />
            Gast
          </button>
        </div>
      </div>
    </div>
  );
}
