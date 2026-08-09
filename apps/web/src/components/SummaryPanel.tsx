import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, fetchBlobUrl } from '../api/client';
import type { MediaItem, RouteCollection, Trip, TripSummaryInfo } from '../api/types';
import type { PlannedStop } from '../lib/arc';
import { useAuth } from '../auth/AuthContext';
import { formatDate } from '../lib/colors';
import { AuthImage } from './AuthImage';
import { confirmModal } from './confirm';
import { Icon } from './Icon';
import { SummaryStudio } from './SummaryStudio';
import './summary.css';

/**
 * Posters made from this trip, and the button that makes another one.
 *
 * Lives in the same sheet as the people and the share links, because it is the
 * same question: who else gets to see this trip, and in what form.
 */
export function SummaryPanel({
  trip,
  stops,
  media,
  routes,
}: {
  trip: Trip;
  stops: PlannedStop[];
  media: MediaItem[];
  routes: RouteCollection | null;
}) {
  const [items, setItems] = useState<TripSummaryInfo[]>([]);
  const [studio, setStudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A deleted poster stays in the list for the length of its exit animation,
  // so the tile folds away instead of blinking out from under your thumb.
  const [leaving, setLeaving] = useState<string[]>([]);
  const { user } = useAuth();
  const hasPhotos = media.some((m) => m.assetType === 'IMAGE');
  // A guest is watching somebody else's trip; making posters out of it is for
  // the people who were on it.
  const isGuest = trip.members.find((m) => m.userId === user?.id)?.role === 'GUEST';

  useEffect(() => {
    api<TripSummaryInfo[]>(`/trips/${trip.id}/summaries`)
      .then(setItems)
      .catch(() => undefined);
  }, [trip.id]);

  async function remove(summary: TripSummaryInfo) {
    const ok = await confirmModal({
      title: 'Samenvatting verwijderen?',
      body: `“${summary.title}” wordt van de server gehaald. Wat je al gedeeld hebt blijft staan.`,
      confirmLabel: 'Verwijderen',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/trips/${trip.id}/summaries/${summary.id}`, { method: 'DELETE' });
      setLeaving((list) => [...list, summary.id]);
      window.setTimeout(() => {
        setItems((list) => list.filter((s) => s.id !== summary.id));
        setLeaving((list) => list.filter((id) => id !== summary.id));
      }, 260);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verwijderen mislukt');
    }
  }

  async function rename(summary: TripSummaryInfo, title: string) {
    const updated = await api<TripSummaryInfo>(`/trips/${trip.id}/summaries/${summary.id}`, {
      method: 'PATCH',
      body: { title },
    });
    setItems((list) => list.map((s) => (s.id === summary.id ? updated : s)));
  }

  return (
    <section className="summary-panel">
      <h2 className="trip-side-heading">
        Samenvattingen <span className="summary-beta">(bèta)</span>
      </h2>
      <p className="muted summary-hint">
        {isGuest
          ? 'Reisgenoten kunnen hier posters van deze reis maken.'
          : hasPhotos
            ? 'Een poster van de reis, van een dag of van een stuk ervan, klaar om te delen.'
            : 'Zodra er foto’s in deze reis staan kun je er een poster van maken.'}
      </p>

      {/* Every layout is built around photographs, and the two that lean on
          them hardest have nothing at all to show without any. So the button
          waits for the first photo rather than making an empty poster. */}
      {!isGuest && (
        <button
          type="button"
          className="btn btn-primary summary-make"
          disabled={!hasPhotos}
          onClick={() => setStudio(true)}
        >
          <Icon name="plus" size={16} />
          Samenvatting maken
        </button>
      )}

      {items.length > 0 && (
        <div className="summary-grid">
          {items.map((summary) => (
            <SummaryCard
              key={summary.id}
              tripId={trip.id}
              summary={summary}
              leaving={leaving.includes(summary.id)}
              onRemove={() => void remove(summary)}
              onRename={(title) => rename(summary, title)}
            />
          ))}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {studio && (
        <SummaryStudio
          trip={trip}
          stops={stops}
          media={media}
          routes={routes}
          onClose={() => setStudio(false)}
          onSaved={(saved) => setItems((list) => [saved, ...list])}
        />
      )}
    </section>
  );
}

/**
 * One poster.
 *
 * The ⋯ menu is the one from the trip cards on the home page, down to the way
 * it opens and closes, because it does the same job in the same app.
 */
function SummaryCard({
  tripId,
  summary,
  leaving,
  onRemove,
  onRename,
}: {
  tripId: string;
  summary: TripSummaryInfo;
  leaving: boolean;
  onRemove: () => void;
  onRename: (title: string) => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  /** Where the menu hangs, in viewport coordinates. See the trip cards. */
  const [menuAt, setMenuAt] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(summary.title);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function closeMenu() {
    if (menuClosing) return;
    setMenuClosing(true);
    window.setTimeout(() => {
      setMenu(false);
      setMenuClosing(false);
      setEditing(false);
    }, 140);
  }

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  });

  const pageUrl = (index: number) => `/trips/${tripId}/summaries/${summary.id}/pages/${index}`;

  /**
   * Hand the poster to whatever the device shares with.
   *
   * The share sheet is the goal, but a WebView does not always have one, so
   * this falls back to a download and finally to simply opening the picture —
   * from where it can be long-pressed and saved.
   */
  async function share() {
    setBusy(true);
    setNote(null);
    try {
      const files: File[] = [];
      for (const page of summary.pages) {
        const url = await fetchBlobUrl(pageUrl(page.index));
        const blob = await fetch(url).then((r) => r.blob());
        files.push(new File([blob], `${slug(summary.title)}-${page.index + 1}.jpg`, { type: blob.type }));
      }
      if (navigator.canShare?.({ files }) && navigator.share) {
        await navigator.share({ files, title: summary.title });
        return;
      }
      for (const file of files) {
        const href = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = href;
        link.download = file.name;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      }
      setNote('Opgeslagen bij je downloads.');
    } catch (err) {
      // A share the user waved away is not a failure worth reporting.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setNote('Delen lukte niet. Houd de afbeelding ingedrukt om hem te bewaren.');
    } finally {
      setBusy(false);
      closeMenu();
    }
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onRename(value.trim() || summary.title);
      closeMenu();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrapRef} className={`summary-card ${leaving ? 'leaving' : ''}`}>
      <button type="button" className="summary-card-shot" onClick={() => void share()}>
        <AuthImage path={pageUrl(0)} alt={summary.title} className="summary-card-img" />
        {summary.pages.length > 1 && (
          <span className="summary-card-count">{summary.pages.length}</span>
        )}
      </button>
      <div className="summary-card-meta">
        <strong>{summary.title}</strong>
        <small>
          {summary.scopeLabel} · {formatDate(summary.createdAt)}
        </small>
      </div>

      <button
        type="button"
        className={`summary-card-menu-btn ${menu && !menuClosing ? 'open' : ''}`}
        aria-label="Meer"
        aria-expanded={menu && !menuClosing}
        onClick={(e) => {
          if (menu) {
            closeMenu();
            return;
          }
          // Against the viewport rather than the tile: a tile is 140px wide in
          // a two-column grid and the menu is wider than that, so anchored to
          // the tile it hung off the side of the sheet.
          const r = e.currentTarget.getBoundingClientRect();
          const up = r.bottom + 230 > window.innerHeight;
          setMenuAt({
            top: up ? r.top : r.bottom,
            right: Math.max(10, window.innerWidth - r.right),
            up,
          });
          setMenu(true);
        }}
      >
        <Icon name="dots" size={20} />
      </button>

      {menu && menuAt &&
        createPortal(
        <div
          className={`summary-menu card ${menuAt.up ? 'up' : ''} ${menuClosing ? 'closing' : ''}`}
          ref={menuRef}
          style={
            menuAt.up
              ? { bottom: window.innerHeight - menuAt.top + 6, right: menuAt.right }
              : { top: menuAt.top + 6, right: menuAt.right }
          }
        >
          {editing ? (
            <form className="summary-menu-form" onSubmit={submitRename}>
              <label htmlFor={`sm-${summary.id}`}>Naam</label>
              <input
                id={`sm-${summary.id}`}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <div className="summary-menu-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                  Terug
                </button>
                <button className="btn btn-primary" disabled={busy}>
                  Opslaan
                </button>
              </div>
            </form>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => void share()}>
                <Icon name="share" size={15} />
                Delen of opslaan
              </button>
              <button type="button" onClick={() => setEditing(true)}>
                <Icon name="pencil" size={15} />
                Naam wijzigen
              </button>
              <button
                type="button"
                className="summary-menu-danger"
                onClick={() => {
                  closeMenu();
                  onRemove();
                }}
              >
                <Icon name="trash" size={15} />
                Verwijderen
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
      {note && <p className="muted summary-card-note">{note}</p>}
    </div>
  );
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'samenvatting'
  );
}
