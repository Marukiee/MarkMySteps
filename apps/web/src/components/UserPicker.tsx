import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Avatar } from './Avatar';
import './userpicker.css';

export interface UserSuggestion {
  id: string;
  username: string;
  displayName: string;
  hasAvatar: boolean;
  sharedTrips: number;
}

interface UserPickerProps {
  value: string;
  onChange: (username: string) => void;
  /** Usernames already on the trip — offering them again is just noise. */
  exclude?: string[];
  placeholder?: string;
  required?: boolean;
}

/**
 * Username field with a type-ahead. Focusing it already shows the people you
 * travel with, so the common case is one tap instead of typing a handle you
 * have to remember exactly.
 */
export function UserPicker({
  value,
  onChange,
  exclude = [],
  placeholder = '@gebruikersnaam',
  required,
}: UserPickerProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [items, setItems] = useState<UserSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<number | undefined>(undefined);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = window.setTimeout(() => {
      api<UserSuggestion[]>(`/users/suggestions?q=${encodeURIComponent(value)}`)
        .then((list) => setItems(list.filter((u) => !exclude.includes(u.username))))
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, value ? 220 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, open, exclude.join(',')]);

  // Animate the list away rather than yanking it on blur.
  const close = () => {
    if (!open) return;
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 160);
  };

  useEffect(() => {
    return () => window.clearTimeout(blurTimer.current);
  }, []);

  const pick = (u: UserSuggestion) => {
    onChange(u.username);
    close();
  };

  return (
    <div className="user-picker" ref={wrapRef}>
      <input
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          window.clearTimeout(blurTimer.current);
          setClosing(false);
          setOpen(true);
        }}
        // A tap on a suggestion blurs the input first, so closing waits a beat.
        onBlur={() => {
          blurTimer.current = window.setTimeout(close, 140);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
        autoComplete="off"
      />
      {open && (items.length > 0 || loading) && (
        <div className={`user-picker-list card ${closing ? 'closing' : ''}`}>
          {items.map((u, i) => (
            <button
              key={u.id}
              type="button"
              className="user-picker-item"
              style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(u)}
            >
              <Avatar
                userId={u.id}
                displayName={u.displayName}
                hasAvatar={u.hasAvatar}
                size={28}
              />
              <span className="user-picker-name">
                {u.displayName}
                <small>@{u.username}</small>
              </span>
              {u.sharedTrips > 0 && (
                <span className="user-picker-tag">
                  {u.sharedTrips} {u.sharedTrips === 1 ? 'reis' : 'reizen'}
                </span>
              )}
            </button>
          ))}
          {items.length === 0 && loading && <span className="user-picker-empty">Zoeken…</span>}
        </div>
      )}
    </div>
  );
}
