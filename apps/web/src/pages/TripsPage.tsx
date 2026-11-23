import {
  FormEvent,
  Fragment,
  MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { Avatar } from '../components/Avatar';
import { confirmModal } from '../components/confirm';
import { DateRangeField } from '../components/DatePicker';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
import { LogoMark } from '../components/Logo';
import { Icon } from '../components/Icon';
import { AppMenu, MENU_CLOSE_MS, MENU_PICK_HOLD_MS, type MenuEntry } from '../components/AppMenu';
import { coverGradient, formatDate, tripCoverBg } from '../lib/colors';
import { useCoverTone } from '../lib/coverTone';
import {
  getShowSelfOnHome,
  getTripCardOverride,
  isTripCompact,
  setTripCardOverride,
} from '../lib/prefs';
import { canEditTrip } from '../lib/perm';
import { nativeMenusAvailable, showNativeMenu } from '../lib/nativeMenu';
import { tripGlyph, tripGlyphSize, tripGlyphStroke } from '../lib/tripGlyph';
import { intlLocale, t } from '../i18n';
import { onTrackerChange } from '../tracking/tracker';
import './trips.css';

/** How many trips this browser saw last time, to size the placeholders. */
const TRIP_COUNT_KEY = 'mms.trips.count';
/** And how they were divided, so the headings can be up before the cards are. */
const TRIP_SHAPE_KEY = 'mms.trips.shape';

interface TripShape {
  upcoming: number;
  past: number;
  friends: number;
}

function rememberedShape(): TripShape {
  try {
    const raw = localStorage.getItem(TRIP_SHAPE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TripShape>;
      // The real counts, not a number of placeholders: the tab pill puts these
      // straight on its badges, so a list of twelve must not read as six until
      // the server answers. The placeholder grid does its own capping.
      const count = (n: unknown) =>
        Number.isFinite(n) ? Math.min(999, Math.max(0, Math.round(Number(n)))) : 0;
      return {
        upcoming: count(parsed.upcoming),
        past: count(parsed.past),
        friends: count(parsed.friends),
      };
    }
    // Nothing that detailed remembered yet, but the old count still tells us
    // roughly how big to draw the shape.
    const count = Number(localStorage.getItem(TRIP_COUNT_KEY));
    if (Number.isFinite(count) && count > 0) return { upcoming: 1, past: Math.min(5, count - 1), friends: 0 };
  } catch {
    /* fall through */
  }
  return { upcoming: 1, past: 1, friends: 0 };
}

/**
 * How many trips lead a wide window as full cards.
 *
 * A phone reads a finished trip as a small card in a stack; a desktop window
 * reads the same card as a full-width row, which is anything but small. So on
 * a wide window the top of every list is photographs, and the tail folds into
 * rows.
 */
const LEAD_LARGE = 3;

/**
 * Whether the window is wide enough for the grid to lay trips side by side.
 *
 * Kept in state rather than read per render, so a window being dragged wider
 * re-lays the cards instead of waiting for the next thing to change.
 */
function useWideWindow(): boolean {
  const query = '(min-width: 721px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/**
 * The shape of the list, before the list.
 *
 * Deliberately the trip card's own geometry — the same grid, the same aspect,
 * the same rounded corner — so what arrives lands in the space that was being
 * held for it instead of pushing a "nothing here" message out of the way.
 *
 * Only the cards. The headings and the tab pill over them are the real ones
 * from the first paint onward: rebuilding those meant the whole "afgelopen /
 * gedeeld" row was thrown away and drawn again the moment the trips landed,
 * when the only thing that had changed about it was the count on the pill.
 */
function SkeletonGrid({ count, offset }: { count: number; offset: number }) {
  return (
    <div className="trips-grid trips-skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="trip-skel" key={i} style={{ animationDelay: `${(i + offset) * 90}ms` }}>
          <div className="trip-skel-shine" />
          <div className="trip-skel-body">
            <span className="trip-skel-line wide" />
            <span className="trip-skel-line" />
            <span className="trip-skel-facts">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TripsPage() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newClosing, setNewClosing] = useState(false);
  // The wordmark's compass follows the globe's zoom: in one way, out the
  // other, and back to north whenever the globe is back where it started.
  // Written straight to the element, because this arrives at frame rate and
  // has no business re-rendering the page.
  const needleRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const onScale = (e: Event) => {
      const scale = (e as CustomEvent<number>).detail;
      if (needleRef.current) {
        needleRef.current.style.transform = `rotate(${(scale - 1) * 660}deg)`;
      }
    };
    window.addEventListener('mms-globe-scale', onScale);
    return () => window.removeEventListener('mms-globe-scale', onScale);
  }, []);

  // The form collapses away instead of vanishing, so the sections below slide
  // back up rather than jumping.
  const closeNew = () => {
    setNewClosing(true);
    window.setTimeout(() => {
      setShowNew(false);
      setNewClosing(false);
    }, 260);
  };
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'past' | 'friends'>('past');
  // Wide enough to lay cards side by side, which is what decides whether a
  // finished trip leads as a photo or as a row.
  const wide = useWideWindow();
  // Read once: the placeholders must not change shape underneath themselves.
  const [shape] = useState(rememberedShape);
  const pastPaneRef = useRef<HTMLDivElement>(null);
  const friendPaneRef = useRef<HTMLDivElement>(null);
  const switchTab = (next: 'past' | 'friends') => setTab(next);
  // Bumped when a card switches size; the layout is read back from localStorage.
  const [sizeTick, setSizeTick] = useState(0);
  // Own position on the globe — opt-in, and only ever from the tracker (the page
  // never asks the browser for a location).
  const [self, setSelf] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!getShowSelfOnHome()) return;
    return onTrackerChange((s) => {
      setSelf(s.lastFix ? [s.lastFix.lng, s.lastFix.lat] : null);
    });
  }, []);

  /** Where every card stood before a size switch, to glide from there. */
  const flipFrom = useRef<{ id: string; rects: Map<string, DOMRect> } | null>(null);

  /** Switch one card between large and compact. */
  function applySize(id: string, value: 'large' | 'compact' | null) {
    const rects = new Map<string, DOMRect>();
    document.querySelectorAll<HTMLElement>('[data-trip-card]').forEach((el) => {
      rects.set(el.dataset.tripCard!, el.getBoundingClientRect());
    });
    flipFrom.current = { id, rects };
    setTripCardOverride(id, value);
    setSizeTick((n) => n + 1);
  }

  /*
   * The switch is one card changing size, not a card going and another one
   * coming: the card grows or shrinks from where it stood to its new box and
   * the trips under it move along in one direction. Emphasized easing, the
   * web's equivalent of the native critically damped spring: nothing passes
   * its place and comes back, the bottom never goes up and then down. The
   * entry animation does not play again for a card that only changed shape.
   */
  useLayoutEffect(() => {
    const from = flipFrom.current;
    if (!from) return;
    flipFrom.current = null;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const easing = 'cubic-bezier(0.2, 0, 0, 1)';
    const duration = 420;
    document.querySelectorAll<HTMLElement>('[data-trip-card]').forEach((el) => {
      const id = el.dataset.tripCard!;
      const old = from.rects.get(id);
      if (!old) return;
      el.style.animation = 'none';
      if (reduce) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (id === from.id) {
        const overflow = el.style.overflow;
        el.style.overflow = 'hidden';
        const anim = el.animate(
          [
            {
              width: `${old.width}px`,
              height: `${old.height}px`,
              transform: `translate(${dx}px, ${dy}px)`,
            },
            { width: `${now.width}px`, height: `${now.height}px`, transform: 'none' },
          ],
          { duration, easing },
        );
        const done = () => {
          el.style.overflow = overflow;
        };
        anim.onfinish = done;
        anim.oncancel = done;
        // The contents of the new shape come up as the box takes it.
        Array.from(el.children).forEach((child) => {
          if (child.classList.contains('trip-card-menu')) return;
          (child as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 260,
            delay: 60,
            easing: 'linear',
            fill: 'backwards',
          });
        });
      } else if (dx !== 0 || dy !== 0) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration,
          easing,
        });
      }
    });
  }, [sizeTick]);

  function load() {
    api<Trip[]>('/trips')
      .then((list) => {
        setTrips(list);
        // So the next cold start can put the right placeholders up — the right
        // number of them, under the right headings — rather than guessing, or
        // showing nothing at all.
        try {
          const today = new Date().toISOString().slice(0, 10);
          const mine = list.filter((trip) => canEditTrip(trip, user?.id));
          const seen: TripShape = {
            upcoming: mine.filter((trip) => trip.endDate.slice(0, 10) >= today).length,
            past: mine.filter((trip) => trip.endDate.slice(0, 10) < today).length,
            friends: list.length - mine.length,
          };
          localStorage.setItem(TRIP_COUNT_KEY, String(list.length));
          localStorage.setItem(TRIP_SHAPE_KEY, JSON.stringify(seen));
        } catch {
          /* storage off: the placeholder count falls back to a guess */
        }
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  /**
   * The cards arrive once there is a screen to arrive on.
   *
   * Cold-starting the app, the list mounts in the same breath as the WebView's
   * very first paint, and a CSS entry animation that starts there has already
   * finished by the time anything is actually on screen — the trips were
   * simply there, while the globe (which draws every frame) was visibly alive.
   * Holding them back until a frame has been painted gives the arrival
   * somewhere to happen.
   */
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (trips === null || revealed) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setRevealed(true));
    });
    // Never leave the page holding its breath if the frames never come.
    const safety = window.setTimeout(() => setRevealed(true), 500);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.clearTimeout(safety);
    };
  }, [trips, revealed]);

  const today = new Date().toISOString().slice(0, 10);
  // Yours = the ones you travelled, as organiser or reisgenoot. A trip you were
  // invited to look at is somebody else's, and gets its own tab.
  const mine = (trips ?? []).filter((trip) => canEditTrip(trip, user?.id));
  const friends = (trips ?? []).filter((trip) => !canEditTrip(trip, user?.id));
  const startedFirst = (a: Trip, b: Trip) => {
    const aStarted = a.startDate.slice(0, 10) <= today ? 0 : 1;
    const bStarted = b.startDate.slice(0, 10) <= today ? 0 : 1;
    if (aStarted !== bStarted) return aStarted - bStarted;
    return a.startDate.localeCompare(b.startDate);
  };
  // Ongoing trips (already started, not finished) are the most relevant → they
  // sort above trips that haven't begun yet.
  const upcoming = mine.filter((trip) => trip.endDate.slice(0, 10) >= today).sort(startedFirst);
  const past = mine.filter((trip) => trip.endDate.slice(0, 10) < today);
  // Somebody who is away right now is the reason you opened this tab.
  const friendTrips = [...friends].sort((a, b) => {
    const aOver = a.endDate.slice(0, 10) < today ? 1 : 0;
    const bOver = b.endDate.slice(0, 10) < today ? 1 : 0;
    if (aOver !== bOver) return aOver - bOver;
    return aOver ? b.startDate.localeCompare(a.startDate) : startedFirst(a, b);
  });
  // The globe is where YOU have been — guests' trips draw no route on it.
  const myGlobeTrips = mine;

  // Which of the two lower tabs is open, and which way it came in. Opens on the
  // friends' tab when you have nothing finished of your own but they do, so the
  // section is never an empty panel under a pill you have to find first.
  const hasPast = past.length > 0;
  const hasFriends = friendTrips.length > 0;
  /*
   * Which sections are on the page, whether or not their trips have arrived.
   *
   * While the list is still on its way the answer comes from what this browser
   * saw last time, so the headings and the tab pill are already the real ones.
   * Nothing about them is rebuilt when the trips land: the count on the pill is
   * the only thing that was missing, and the count is the only thing that
   * appears.
   */
  const loading = trips === null && !error;
  /*
   * Whether the "+ nieuwe reis" tile still earns its place.
   *
   * With a handful of trips it fills the gap at the end of the row and is the
   * obvious next thing to do. Past six it is a full-size card at the bottom of
   * a long list, in the way of the trips you actually came for; the button in
   * the header does the same job without taking a slot.
   */
  const roomForGhost = mine.length < 6;
  const showUpcoming = loading ? shape.upcoming > 0 : upcoming.length > 0;
  const showLower = loading ? shape.past > 0 || shape.friends > 0 : hasPast || hasFriends;
  useEffect(() => {
    if (!hasPast && hasFriends) setTab('friends');
  }, [hasPast, hasFriends]);

  /**
   * The height of the pane that is open.
   *
   * The two lists are rarely the same length, and a track that is as tall as
   * its tallest child would leave a hole under the short one. Measured and
   * animated instead, so the page grows or shrinks with the slide rather than
   * snapping — and so the scroll position is never yanked upwards in one frame
   * when you switch to a list with a single trip in it.
   */
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const pane = (tab === 'past' ? pastPaneRef : friendPaneRef).current;
    if (!pane) return;
    const measure = () => setPaneHeight(pane.offsetHeight);
    measure();
    // Covers a cover photo arriving, a card switching size, and the window
    // being resized — all of which change how tall the open list is.
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [tab, past.length, friendTrips.length, sizeTick]);

  const renderPane = (which: 'past' | 'friends') => {
    const list = which === 'past' ? past : friendTrips;
    if (list.length === 0) {
      return (
        <p className="muted trips-tab-empty">
          {which === 'past' ? t('trips.tab.pastEmpty') : t('trips.tab.sharedEmpty')}
        </p>
      );
    }
    return (
      <div className="trips-grid">
        {list.map((trip, i) => {
          // As the apps: the latest trips large (one on a phone, a row of them on a wide window), the rest as
          // rows under a heading per year.
          const compactAt = (k: number) => isTripCompact(list[k]!.id, wide ? k >= LEAD_LARGE : k >= 1);
          const compact = compactAt(i);
          const year = trip.startDate.slice(0, 4);
          const newYear = compact && (i === 0 || !compactAt(i - 1) || list[i - 1]!.startDate.slice(0, 4) !== year);
          return (
            <Fragment key={trip.id}>
              {newYear && <h3 className="trips-year">{year}</h3>}
              <TripCard
                trip={trip}
                index={i}
                onChanged={load}
                onResize={applySize}
                wide={wide}
                compact={compact}
              />
            </Fragment>
          );
        })}
        {which === 'past' && upcoming.length === 0 && roomForGhost && (
          <button className="trip-ghost" onClick={() => setShowNew(true)} aria-label={t('trips.newTrip')}>
            <span>{t('trips.newTripButton')}</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <main className="page fade-in trips-page" data-revealed={revealed}>
      {/* The wordmark sits in the globe's own box, which is the thing that
          actually reaches the top of the screen — positioning it against the
          page put it below the page's padding instead. On a wide window the top
          bar already carries the brand, so this only shows where that bar is
          gone (phone, and the app). */}
      <div className="trips-globe">
        <GlobeBackdrop trips={myGlobeTrips} selfLocation={self} />
        <span className="trips-brand" aria-label="MarkMySteps">
          <LogoMark size={40} needleRef={needleRef} />
          <span>MarkMySteps</span>
        </span>
      </div>

      <div className="trips-head">
        <h1>{t('common.trips')}</h1>
        <div className="trips-head-actions">
          <button
            className="btn btn-primary"
            onClick={() => (showNew ? closeNew() : setShowNew(true))}
          >
            {showNew && !newClosing ? t('common.cancel') : t('trips.newTripButton')}
          </button>
        </div>
      </div>

      {showNew && (
        <div className={`new-trip-wrap ${newClosing ? 'closing' : ''}`}>
          <div>
            <NewTripForm
              onCreated={() => {
                closeNew();
                load();
              }}
            />
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {trips?.length === 0 && (
        <div className="card trips-empty">
          <h2>{t('trips.none.title')}</h2>
          <p className="muted">
            {t('trips.none.body')}
          </p>
        </div>
      )}

      {showUpcoming && (
        <>
          <h2 className="trips-section-title">{t('trips.section.upcoming')}</h2>
          {loading ? (
            <SkeletonGrid count={Math.min(6, shape.upcoming)} offset={0} />
          ) : (
          <div className="trips-grid trips-upcoming">
            {upcoming.map((trip, i) => {
              const c = isTripCompact(trip.id, false);
              return (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  index={i}
                  onChanged={load}
                  onResize={applySize}
                  wide={wide}
                  compact={c}
                />
              );
            })}
            {roomForGhost && (
              <button
                className="trip-ghost"
                onClick={() => setShowNew(true)}
                aria-label={t('trips.newTrip')}
              >
                <span>{t('trips.newTripButton')}</span>
              </button>
            )}
          </div>
          )}
        </>
      )}

      {showLower && (
        <>
          {/* The heading was a heading; now it is the choice between your own
              finished trips and the ones you were invited to watch. One pill
              slides between the two, and the grid under it slides the way you
              moved — left tab from the left, right tab from the right. */}
          <div className="trips-tabs" role="tablist" data-tab={tab}>
            <span className="trips-tabs-thumb" aria-hidden="true" />
            <button
              role="tab"
              aria-selected={tab === 'past'}
              className={tab === 'past' ? 'active' : ''}
              disabled={loading}
              onClick={() => switchTab('past')}
            >
              {t('trips.tab.past')}
              {/* Last time's count while the list is on its way, so the badge
                  is not a box that appears out of nothing and shoves the label
                  sideways. It is a number this browser has actually seen; if
                  it has changed, it changes in place when the trips land. */}
              <small>{(loading ? shape.past : past.length) || ''}</small>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'friends'}
              className={tab === 'friends' ? 'active' : ''}
              disabled={loading}
              onClick={() => switchTab('friends')}
            >
              {t('trips.tab.shared')}
              <small>{(loading ? shape.friends : friendTrips.length) || ''}</small>
            </button>
          </div>

          {/* Both lists stay mounted and ride on one track that slides sideways.
              Swapping the contents of a single panel meant every card was built
              again on every switch — which is what made the top cover flash a
              dark, square block while its photo decoded a second time. */}
          <div className="trips-switch" style={paneHeight ? { height: paneHeight } : undefined}>
            {loading ? (
              <SkeletonGrid
                count={Math.min(6, Math.max(1, shape.past || shape.friends))}
                offset={Math.min(6, shape.upcoming)}
              />
            ) : (
            <div className="trips-track" data-tab={tab}>
              <div className="trips-pane" ref={pastPaneRef} aria-hidden={tab !== 'past'}>
                {renderPane('past')}
              </div>
              <div className="trips-pane" ref={friendPaneRef} aria-hidden={tab !== 'friends'}>
                {renderPane('friends')}
              </div>
            </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function TripCard({
  trip,
  index,
  onChanged,
  onResize,
  compact = false,
  wide = false,
}: {
  trip: Trip;
  index: number;
  onChanged: () => void;
  onResize: (id: string, value: 'large' | 'compact' | null) => void;
  compact?: boolean;
  /** Wide window: the size menu is naming two shapes, not two sizes. */
  wide?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  /** The size just picked in the menu: the pill moves over at once, the card
   *  takes its new shape once the menu has folded away. */
  const [pickedSize, setPickedSize] = useState<'auto' | 'large' | 'compact' | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(trip.title);
  const renameRef = useRef<HTMLFormElement>(null);
  const isOwner = trip.ownerId === user?.id;
  // The colour the row leans to, as the apps: its cover's tone, else the trip's own colour.
  const coverTone = useCoverTone(trip.resolvedCoverId);
  const tone = coverTone ?? trip.color ?? toneFromId(trip.id);

  const closeMenu = () => setMenuOpen(false);

  // Tapping anywhere else abandons a rename, the same way the ⋯ menu closes.
  useEffect(() => {
    if (!renaming) return;
    const close = (e: Event) => {
      if (!renameRef.current?.contains(e.target as Node)) cancelRename();
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming]);

  function cancelRename() {
    setRenaming(false);
    // Discard the half-typed title, or reopening shows it again.
    setNewTitle(trip.title);
  }

  function stop(e: MouseEvent) {
    e.stopPropagation();
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    await api(`/trips/${trip.id}`, { method: 'PATCH', body: { title: newTitle.trim() } });
    setRenaming(false);
    onChanged();
  }

  async function remove() {
    const ok = await confirmModal({
      title: t('trips.delete.title'),
      body: t('trips.delete.body', { title: trip.title }),
      confirmLabel: t('common.delete'),
      danger: true,
      typeToConfirm: trip.title,
    });
    if (!ok) return;
    await api(`/trips/${trip.id}`, { method: 'DELETE' });
    onChanged();
  }

  async function leave() {
    const ok = await confirmModal({
      title: t('trips.leave.title'),
      body: t('trips.leave.body', { title: trip.title }),
      confirmLabel: t('trips.leave.confirm'),
      danger: true,
    });
    if (!ok) return;
    await api(`/trips/${trip.id}/members/${user!.id}`, { method: 'DELETE' });
    onChanged();
  }

  function setSize(opt: 'auto' | 'large' | 'compact') {
    /*
     * The pill moves over first, the menu folds back into its button (it
     * closes itself a moment after a choice), and the card changes shape once
     * the menu has gone: resizing under an open menu re-renders the card into
     * a different shape, which would take the button the menu folds into
     * with it.
     */
    setPickedSize(opt);
    window.setTimeout(
      () => onResize(trip.id, opt === 'auto' ? null : opt),
      MENU_PICK_HOLD_MS + MENU_CLOSE_MS + 40,
    );
  }

  /**
   * On a phone the two shapes really are a big card and a small one. In a
   * window wide enough to stand cards beside each other the "small" one is a
   * row across the full width, so it is named for what it looks like instead.
   */
  const sizeLabel = (opt: 'auto' | 'large' | 'compact') =>
    opt === 'auto'
      ? t('common.auto')
      : opt === 'large'
        ? wide
          ? t('trips.card.size.card')
          : t('trips.card.size.large')
        : wide
          ? t('trips.card.size.row')
          : t('trips.card.size.small');

  function openWebMenu() {
    setPickedSize(null);
    setMenuOpen(true);
  }

  /**
   * On the iPhone the ⋯ is the system's own menu: the card's size, ticked,
   * above a line and what can be done with the trip under it. The card takes
   * its new shape at once, as the menu has already gone.
   */
  async function openNativeMenu(from: HTMLElement): Promise<void> {
    const size = getTripCardOverride(trip.id) ?? 'auto';
    const sizes = (['auto', 'large', 'compact'] as const).map((opt) => ({
      id: `size:${opt}`,
      title: sizeLabel(opt),
      checked: size === opt,
    }));
    const actions = isOwner
      ? [
          { id: 'settings', title: t('common.settings'), symbol: 'gearshape' },
          { id: 'rename', title: t('trips.card.menu.rename'), symbol: 'pencil' },
          { id: 'delete', title: t('common.delete'), symbol: 'trash', destructive: true },
        ]
      : [
          {
            id: 'leave',
            title: t('trips.card.menu.leave'),
            symbol: 'rectangle.portrait.and.arrow.right',
            destructive: true,
          },
        ];
    const picked = await showNativeMenu(from, [sizes, actions]);
    if (picked?.startsWith('size:')) {
      const opt = picked.slice(5);
      onResize(trip.id, opt === 'large' || opt === 'compact' ? opt : null);
    } else if (picked === 'settings') navigate(`/trips/${trip.id}/settings`);
    else if (picked === 'rename') setRenaming(true);
    else if (picked === 'delete') void remove();
    else if (picked === 'leave') void leave();
  }

  const month = new Date(trip.startDate).toLocaleDateString(intlLocale(), { month: 'long' });
  const year = new Date(trip.startDate).getFullYear();
  const days =
    Math.round(
      (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / 86_400_000,
    ) + 1;

  // Countdown to the START (only for trips that haven't begun). The hourglass +
  // "over N dagen" wording makes clear it's the start, not the trip length.
  const startsInDays = daysUntil(trip.startDate);
  const countdown =
    startsInDays === null
      ? null
      : startsInDays === 0
        ? t('trips.card.startsToday')
        : startsInDays === 1
          ? t('trips.card.startsTomorrow')
          : t('trips.card.startsIn', { count: startsInDays });
  // An ongoing trip (started, not finished) gets its own "onderweg" pill in the
  // same spot as the countdown — those are mutually exclusive.
  const todayStr = new Date().toISOString().slice(0, 10);
  const ongoing =
    trip.startDate.slice(0, 10) <= todayStr && trip.endDate.slice(0, 10) >= todayStr;
  // On somebody else's trip the pill says who is away — "onderweg" on a card
  // you are only watching read as though you were the one travelling.
  // A reisgenoot is away too, so this is about guests only.
  const travellerName = canEditTrip(trip, user?.id)
    ? null
    : trip.members.find((m) => m.userId === trip.ownerId)?.user.displayName ?? null;
  const statusEl = ongoing ? (
    <span className="trip-countdown trip-ongoing">
      <span className="trip-ongoing-dot" />
      {travellerName ? t('trips.card.ongoingWho', { name: travellerName }) : t('trips.card.ongoing')}
    </span>
  ) : (
    countdown && (
      <span className="trip-countdown">
        <Icon name="hourglass" size={13} />
        {countdown}
      </span>
    )
  );

  const currentSize = pickedSize ?? getTripCardOverride(trip.id) ?? 'auto';
  // As on the native apps: the card's size, then rename and delete (or leave a
  // trip someone else made). Settings live on the trip page.
  const menuGroups: MenuEntry[][] = [
    [
      ...(['auto', 'large', 'compact'] as const).map((opt) => ({
        label: sizeLabel(opt),
        inline: true,
        selected: currentSize === opt,
        onClick: () => setSize(opt),
      })),
      ...(isOwner
        ? [
            { label: t('trips.card.menu.rename'), icon: 'pencil' as const, onClick: () => setRenaming(true) },
            { label: t('common.delete'), icon: 'trash' as const, danger: true, onClick: () => void remove() },
          ]
        : [{ label: t('trips.card.menu.leave'), danger: true, onClick: () => void leave() }]),
    ],
  ];

  const menuEl = (
    <div className="trip-card-menu" onClick={stop}>
      <button
        ref={menuBtnRef}
        className="trip-menu-btn"
        aria-label={t('trips.card.menu.label')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          stop(e);
          const button = e.currentTarget as HTMLElement;
          if (menuOpen) closeMenu();
          else if (nativeMenusAvailable()) {
            // This iOS cannot open a menu itself: the page's one opens instead.
            openNativeMenu(button).catch(() => openWebMenu());
          } else {
            openWebMenu();
          }
        }}
      >
        <Icon name="dots" size={22} />
      </button>
      <AppMenu
        anchor={menuBtnRef.current}
        open={menuOpen}
        onClose={closeMenu}
        groups={menuGroups}
        // The large card's ⋯ is a round glass button; the small card's is a
        // bare icon, so no round fill ever shows there.
        buttonColor={compact ? undefined : 'rgb(255 255 255 / 0.5)'}
      />
    </div>
  );

  // Compact: a slim row — meta on the left, small photo on the right.
  if (compact) {
    return (
      <div
        data-trip-card={trip.id}
        className="trip-card-compact"
        style={{
          animationDelay: `${index * 45}ms`,
          ['--tone' as string]: tone,
        }}
        role="link"
        tabIndex={0}
        onClick={() => !renaming && navigate(`/trips/${trip.id}`)}
        onKeyDown={(e) => e.key === 'Enter' && !renaming && navigate(`/trips/${trip.id}`)}
      >
        {/* Its cover small on the left, or the trip's colour with the compass, as the apps' rows. */}
        {trip.resolvedCoverId ? (
          <AuthImage path={`/media/${trip.resolvedCoverId}/thumbnail`} alt="" className="tcc-photo" />
        ) : (
          <span className="tcc-photo tcc-glyph" style={{ background: tripCoverBg(trip) }} aria-hidden="true">
            <Icon name="compass" size={30} strokeWidth={1.7} />
          </span>
        )}
        <div className="tcc-body">
          {renaming ? (
            <form ref={renameRef} onSubmit={rename} onClick={stop} className="trip-rename">
              <input
                autoFocus
                value={newTitle}
                onClick={stop}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') cancelRename();
                }}
              />
              <button
                type="button"
                className="trip-rename-cancel"
                aria-label={t('common.cancel')}
                onClick={(e) => {
                  stop(e);
                  cancelRename();
                }}
              >
                <Icon name="close" size={16} />
              </button>
              <button className="btn btn-primary trip-rename-ok" type="submit">
                <Icon name="check" size={16} />
              </button>
            </form>
          ) : (
            <h3>{trip.title}</h3>
          )}
          <span className="tcc-meta">
            {month} {year} · {t('common.days', { count: days })}
            {trip.distanceKm != null && trip.distanceKm > 0 && (
              <> · {trip.distanceKm.toLocaleString(intlLocale())} {t('common.km')}</>
            )}
          </span>
          {statusEl}
        </div>
        {menuEl}
      </div>
    );
  }

  // Full-bleed photo card (Polarsteps-style): title + meta overlaid, ⋯ top-right.
  const noImg = !trip.resolvedCoverId;
  return (
    <div
      data-trip-card={trip.id}
      className={`trip-card ${noImg ? 'trip-card-noimg' : ''}`}
      style={{
        animationDelay: `${index * 60}ms`,
        background: noImg ? tripCoverBg(trip) : coverGradient(trip.id),
      }}
      role="link"
      tabIndex={0}
      onClick={() => {
        if (!renaming) navigate(`/trips/${trip.id}`);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !renaming) navigate(`/trips/${trip.id}`);
      }}
    >
      {trip.resolvedCoverId && (
        <AuthImage
          path={`/media/${trip.resolvedCoverId}/thumbnail`}
          alt=""
          className="trip-card-photo"
        />
      )}
      {noImg && (
        <span className="trip-card-glyph" data-glyph={tripGlyph(trip.title)} aria-hidden="true">
          <Icon
                name={tripGlyph(trip.title)}
                size={tripGlyphSize(trip.title, 190)}
                strokeWidth={tripGlyphStroke(trip.title)}
              />
        </span>
      )}
      {/* As the apps: a trip still to come wears its countdown large, "23 dagen tot vertrek", instead of a
          small pill; an ongoing one keeps its live chip. */}
      {!ongoing && startsInDays !== null && startsInDays > 0 ? (
        <div className="trip-card-count">
          <strong>{startsInDays}</strong>
          <span>
            <b>{t('trips.card.daysUnit', { count: startsInDays })}</b>
            <small>{t('trips.card.countTail')}</small>
          </span>
        </div>
      ) : (
        statusEl
      )}
      <div className="trip-card-overlay">
        {renaming ? (
          <form onSubmit={rename} onClick={stop} className="trip-rename">
            <input
              autoFocus
              value={newTitle}
              onClick={stop}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
            <button className="btn btn-primary" type="submit">
              {t('common.ok')}
            </button>
          </form>
        ) : (
          <h2>{trip.title}</h2>
        )}
        {/* The facts as soft pills on the photo, as the apps: "dec 2026", "8 dagen", "6.616 km". */}
        <div className="trip-card-meta">
          <span className="tcm">
            {new Date(trip.startDate).toLocaleDateString(intlLocale(), { month: 'short' }).replace('.', '')} {year}
          </span>
          <span className="tcm">
            {days} {t('trips.card.daysUnit', { count: days })}
          </span>
          {trip.distanceKm != null && trip.distanceKm > 0 && (
            <span className="tcm tcm-km">
              {trip.distanceKm.toLocaleString(intlLocale())} {t('common.km')}
            </span>
          )}
          <TripCardMembers members={trip.members} ownerId={trip.ownerId} tripId={trip.id} />
        </div>

        {menuEl}
      </div>
    </div>
  );
}

function NewTripForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/trips', { method: 'POST', body: { title, startDate, endDate } });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card new-trip-form fade-in" onSubmit={submit}>
      <div className="field">
        <label htmlFor="nt-title">{t('trips.new.title')}</label>
        <input id="nt-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <DateRangeField
        id="nt-dates"
        label={t('trips.new.dates')}
        from={startDate}
        to={endDate}
        onChange={(from, to) => {
          setStartDate(from);
          setEndDate(to);
        }}
      />
      {error && <p className="error-text">{error}</p>}
      <button className="btn btn-primary" disabled={busy || !startDate || !endDate}>
        {t('trips.new.create')}
      </button>
    </form>
  );
}

/** Whole days from today until a trip's start; null once it has started. */
function daysUntil(startDate: string): number | null {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((start.getTime() - today.getTime()) / 86_400_000);
  return diff < 0 ? null : diff;
}

/**
 * At most two avatars, stacked tight; any extras collapse to a +N chip.
 *
 * Tapping the faces is a shortcut into the trip's "Mensen & delen" sheet:
 * seeing who is on a trip is usually the moment you want to change it, and
 * the long way round is the trip page, the aside and then the sheet.
 */
function TripCardMembers({
  members,
  ownerId,
  tripId,
}: {
  members: Trip['members'];
  ownerId: string;
  tripId: string;
}) {
  const navigate = useNavigate();
  // The faces are the travellers, yourself included; guests only look along (as in the apps).
  const sorted = members
    .filter((m) => m.role !== 'GUEST')
    .sort((a, b) => (a.userId === ownerId ? -1 : b.userId === ownerId ? 1 : 0));
  const visible = sorted.slice(0, 2);
  const extra = sorted.length - visible.length;

  return (
    <button
      type="button"
      className="trip-card-members"
      aria-label={t('trips.card.people')}
      onClick={(e) => {
        // The whole card is already a link to the trip; without this the card
        // wins and the sheet never opens.
        e.stopPropagation();
        navigate(`/trips/${tripId}?people=1`);
      }}
    >
      {visible.map((m, i) => (
        <Avatar
          key={m.userId}
          userId={m.userId}
          displayName={m.user.displayName}
          hasAvatar={m.user.hasAvatar}
          size={26}
          className="member-dot"
          style={{ zIndex: visible.length - i }}
        />
      ))}
      {extra > 0 && <span className="member-more">+{extra}</span>}
    </button>
  );
}

/** A calm tone for a trip without a colour or cover, steady per trip. */
function toneFromId(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 45% 62%)`;
}
