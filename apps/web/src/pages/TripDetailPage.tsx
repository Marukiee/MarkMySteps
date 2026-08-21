import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { LiveFix, MediaItem, RouteCollection, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AuthImage } from '../components/AuthImage';
import { ChoiceOption, chooseModal, confirmModal } from '../components/confirm';
import { DayFilter, type TripDay } from '../components/DayFilter';
import { Icon } from '../components/Icon';
import { FastScroll } from '../components/FastScroll';
import { Lightbox } from '../components/Lightbox';
import { MembersPanel } from '../components/MembersPanel';
import { PhotoBook } from '../components/PhotoBook';
import { SharePanel } from '../components/SharePanel';
import { SummaryPanel } from '../components/SummaryPanel';
import { Timeline } from '../components/Timeline';
import { TrackPointsEditor } from '../components/TrackPointsEditor';
import { TripMap, TripMapApi, Waypoint } from '../components/TripMap';
import { TripFacts } from '../components/TripFacts';
import { TripPlanner } from '../components/TripPlanner';
import type { TripNote } from '../components/DayNote';
import { countStopPlaces, type PlannedStop } from '../lib/arc';
import { popWasOurs } from '../lib/backStack';
import { useExit } from '../lib/useExit';
import { colorForUser, formatDate, tripCoverBg } from '../lib/colors';
import { listDeviceMedia } from '../lib/deviceMedia';
import { lastSeenLabel, useNow } from '../lib/lastSeen';
import { canEditTrip } from '../lib/perm';
import { tripGlyph, tripGlyphSize, tripGlyphStroke } from '../lib/tripGlyph';
import { stableViewportHeight } from '../lib/native';
import { getMapStyle, getTripFacts } from '../lib/prefs';
import { FactId, resolveFacts } from '../lib/tripFacts';
import { onTrackerChange } from '../tracking/tracker';
import { TripAccessPage } from './TripAccessPage';
import './tripdetail.css';

interface TripStats {
  distanceKm: number;
  countries: string[];
  days: number;
  photoCount: number;
}

export function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [routes, setRoutes] = useState<RouteCollection | null>(null);
  /** One day of the trip, or the whole thing (null). */
  const [day, setDay] = useState<string | null>(null);
  const [days, setDays] = useState<TripDay[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [visibleUsers, setVisibleUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  /** The trip refused to open: you are not on it (or it is gone). */
  const [noAccess, setNoAccess] = useState(false);
  const [addPointMode, setAddPointMode] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Arriving from a trip card's avatars means "let me manage who is on this",
  // so the sheet is already open when the page paints. The flag is consumed
  // straight away, or closing it and reloading would just open it again.
  const [searchParams, setSearchParams] = useSearchParams();
  const [peopleOpen, setPeopleOpen] = useState(searchParams.get('people') === '1');
  const [peopleClosing, setPeopleClosing] = useState(false);
  useEffect(() => {
    if (!searchParams.has('people')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('people');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [currentLoc, setCurrentLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [liveTracking, setLiveTracking] = useState(false);
  const [liveFixes, setLiveFixes] = useState<LiveFix[]>([]);
  // Ages next to each traveller tick on their own, between polls.
  const liveTick = useNow(5_000);
  // How many travellers are shown besides you. The pill keeps rendering the
  // last non-zero value so the counter doesn't read "+0" on its way out.
  const extraCount = Math.max(0, visibleUsers.size - 1);
  const shownExtraRef = useRef(extraCount);
  if (extraCount > 0) shownExtraRef.current = extraCount;
  const shownExtra = shownExtraRef.current;
  // A guest is here to look at the trip, not to change it: no notes, no
  // waypoints, no drawing over the route, and a routeplanner that only reads.
  const canEdit = canEditTrip(trip, user?.id);
  const [personMenuOpen, setPersonMenuOpen] = useState(false);
  const [personMenuClosing, setPersonMenuClosing] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<{ lng: number; lat: number } | null>(null);
  const [pointTime, setPointTime] = useState('');
  const [stops, setStops] = useState<PlannedStop[]>([]);
  const [tab, setTab] = useState<'timeline' | 'plan'>('timeline');
  const planPushedRef = useRef(false);
  const [planPick, setPlanPick] = useState<{ lat: number; lng: number } | null>(null);
  const [stats, setStats] = useState<TripStats | null>(null);
  const [notes, setNotes] = useState<TripNote[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  // Tapping your own dot on the map opens today's raw fixes.
  const [pointsOpen, setPointsOpen] = useState(false);
  // Far enough down the timeline that getting back up is worth a button.
  const [scrolled, setScrolled] = useState(false);
  const [backTopShown, backTopClosing] = useExit(scrolled, 220);
  /** Until this moment, the timeline must not drag the camera around. */
  const suppressFocus = useRef(0);
  const scrollRef = useRef<HTMLElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const mapApiRef = useRef<TripMapApi | null>(null);
  const mediaRef = useRef<MediaItem[]>([]);
  mediaRef.current = media;

  // Map follows the timeline: as you scroll, focus the camera on the photos
  // currently visible in the list, so the map shows where you are in the trip.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Desktop scrolls the side column, mobile scrolls the page itself — listen
    // on both, or the map only follows the timeline on a phone.
    const scrollers = [el, sideRef.current].filter((n): n is HTMLElement => !!n);
    let focusTimer = 0;
    let lastKey = '';

    // The map shrink is driven purely by CSS (scroll-timeline) so it stays on
    // the compositor and never janks. Here we only move the camera to follow
    // the timeline, and only once scrolling settles.
    const focusVisible = () => {
      const api = mapApiRef.current;
      // While the page is smooth-scrolling back to the top, the photos flying
      // past would each pull the camera to themselves and the map would end up
      // wherever the scroll happened to finish.
      if (!api || suppressFocus.current > Date.now()) return;
      // On a phone the map covers the top of the screen; on desktop it's a
      // separate column, so the whole viewport height counts.
      const mapBottom = window.matchMedia('(max-width: 900px)').matches
        ? window.innerHeight * 0.42
        : 0;
      const coords: [number, number][] = [];
      const seen = new Set<string>();
      for (const node of document.querySelectorAll<HTMLElement>('[data-media-id]')) {
        const r = node.getBoundingClientRect();
        if (r.bottom < mapBottom || r.top > window.innerHeight) continue;
        const id = node.dataset.mediaId!;
        if (seen.has(id)) continue;
        seen.add(id);
        const m = mediaRef.current.find((x) => x.id === id);
        if (m && m.latitude !== null && m.longitude !== null) coords.push([m.longitude, m.latitude]);
      }
      if (coords.length === 0) return;
      const key = `${coords.length}:${coords[0]![0].toFixed(2)},${coords[0]![1].toFixed(2)}`;
      if (key === lastKey) return;
      lastKey = key;
      api.focusOn(coords);
    };

    // Mobile only: shrink the fixed map as the page scrolls (content slides up
    // under it at 1×), down to a floor so the map always stays visible.
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    // Keyboard-independent height, so focusing an input never resizes the map.
    const vh = stableViewportHeight() / 100;
    const startH = 55 * vh;
    const minH = 32 * vh;
    let raf = 0;
    const shrinkMap = () => {
      const panel = mapPanelRef.current;
      if (!panel || !isMobile) return;
      const height = Math.max(minH, startH - el.scrollTop);
      panel.style.height = `${height}px`;
      // The canvas keeps its full height and is clipped at the bottom; tell the
      // map how much is hidden so it frames photos in the visible strip rather
      // than behind the timeline. Applied on the next camera move, so this
      // stays a cheap assignment during the scroll.
      mapApiRef.current?.setHiddenBottom(startH - height);
    };
    shrinkMap();

    const onScroll = () => {
      // Height update on rAF so it stays glued to the scroll (no lag/jank).
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; shrinkMap(); });
      const top = el.scrollTop;
      setScrolled(top > 260);
      // Back at the top: the camera has been walking along with the timeline,
      // so put it back on the trip as a whole.
      if (top < 40 && lastKey !== '') {
        lastKey = '';
        mapApiRef.current?.resetView();
      }
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(focusVisible, 180);
    };
    for (const node of scrollers) node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      for (const node of scrollers) node.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(focusTimer);
    };
  }, [trip]);

  // Live "you are here" dot, sourced ONLY from the tracker. The browser's
  // geolocation was previously used as a fallback, which made the website ask
  // for location permission on every trip page — it now never does.
  useEffect(() => {
    return onTrackerChange((s) => {
      // Any recent fix places the "you are here" dot, including the single one
      // taken at app start — you shouldn't have to be tracking THIS trip to see
      // where you are on its map.
      if (s.lastFix && Date.now() - s.lastFix.at < 30 * 60_000) {
        setCurrentLoc({ lat: s.lastFix.lat, lng: s.lastFix.lng });
      }
      setLiveTracking(s.tripId === tripId && !!tripId);
    });
  }, [tripId]);

  // Live "who's where": poll each traveller's latest fix (Snap-map style).
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    const load = () =>
      api<LiveFix[]>(`/trips/${tripId}/live`)
        .then((f) => alive && setLiveFixes(f))
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [tripId]);

  // Every reload of the line goes through here, so switching to a day is not
  // something the next "the route changed" refetch can quietly undo.
  const dayRef = useRef<string | null>(null);
  dayRef.current = day;
  const reloadRoutes = useCallback(() => {
    if (!tripId) return;
    const filter = dayRef.current ? `?day=${dayRef.current}` : '';
    api<RouteCollection>(`/trips/${tripId}/route${filter}`)
      .then(setRoutes)
      .catch(() => undefined);
  }, [tripId]);

  const loadData = useCallback(() => {
    if (!tripId) return;
    api<Trip>(`/trips/${tripId}`)
      .then((t) => {
        setTrip(t);
        // Default to the owner's + your own track, so multiple travellers'
        // routes don't cross by default — toggle the rest on via the chips.
        // As a guest you are not on this trip: putting your own id in here
        // counted you as a traveller whose route was being shown.
        const mine = canEditTrip(t, user?.id) ? user?.id : undefined;
        setVisibleUsers((cur) =>
          cur.size > 0 ? cur : new Set([t.ownerId, mine].filter((x): x is string => !!x)),
        );
      })
      .catch((err: Error) => {
        // The server answers 404 for a trip you are not on, whether or not it
        // exists — so this is the door, not a dead end. The access screen asks
        // the server what it may say and offers to knock.
        if (err instanceof ApiError && err.status === 404) setNoAccess(true);
        else setError(err.message);
      });
    reloadRoutes();
    // The server's photos, plus any that were left on this phone. They are the
    // same thing to everything downstream — timeline, map, lightbox — so they
    // arrive as one list, sorted by when they were taken like the server's own.
    Promise.all([
      api<MediaItem[]>(`/trips/${tripId}/media`).catch(() => [] as MediaItem[]),
      listDeviceMedia(tripId).catch(() => [] as MediaItem[]),
    ])
      .then(([remote, local]) =>
        setMedia(
          local.length === 0
            ? remote
            : [...remote, ...local].sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
        ),
      )
      .catch(() => undefined);
    api<PlannedStop[]>(`/trips/${tripId}/stops`).then(setStops).catch(() => undefined);
    api<TripStats>(`/trips/${tripId}/stats`).then(setStats).catch(() => undefined);
    api<TripNote[]>(`/trips/${tripId}/notes`).then(setNotes).catch(() => undefined);
    api<Waypoint[]>(`/trips/${tripId}/points`).then(setWaypoints).catch(() => undefined);
    api<TripDay[]>(`/trips/${tripId}/days`).then(setDays).catch(() => undefined);
  }, [tripId, reloadRoutes]);

  // Picking a day fetches that day's line and runs the light along it, the way
  // the home globe lights up the trip you point at. Going back to the whole
  // trip just reloads: nothing to single out.
  const firstDayRender = useRef(true);
  useEffect(() => {
    if (firstDayRender.current) {
      firstDayRender.current = false;
      return;
    }
    if (!tripId) return;
    const filter = day ? `?day=${day}` : '';
    api<RouteCollection>(`/trips/${tripId}/route${filter}`)
      .then((collection) => {
        setRoutes(collection);
        if (!day) {
          // Back to the whole trip: frame the whole trip again.
          mapApiRef.current?.resetView();
          return;
        }
        // A day is a much smaller thing than a trip, and looking at it on the
        // trip's own camera means a dot somewhere in a continent. Frame the
        // day first, then run the light along it once the camera has settled.
        const coords: [number, number][] = [];
        for (const feature of collection.features) {
          for (const point of feature.geometry.coordinates as [number, number][]) {
            coords.push(point);
          }
        }
        for (const item of mediaRef.current) {
          if (item.takenAt.slice(0, 10) !== day) continue;
          if (item.latitude === null || item.longitude === null) continue;
          coords.push([item.longitude, item.latitude]);
        }
        if (coords.length > 0) mapApiRef.current?.focusOn(coords);
        window.setTimeout(() => mapApiRef.current?.glowRoutes(), coords.length > 0 ? 780 : 150);
      })
      .catch(() => undefined);
  }, [day, tripId]);

  const deleteWaypoint = useCallback(
    async (id: string) => {
      if (!tripId) return;
      await api(`/trips/${tripId}/points/${id}`, { method: 'DELETE' });
      setWaypoints((cur) => cur.filter((w) => w.id !== id));
      reloadRoutes();
    },
    [tripId, reloadRoutes],
  );

  const saveNote = useCallback(
    async (day: string, body: string) => {
      if (!tripId) return;
      setNotes(await api<TripNote[]>(`/trips/${tripId}/notes`, { method: 'PUT', body: { day, body } }));
    },
    [tripId],
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!tripId) return;
      await api(`/trips/${tripId}/notes/${noteId}`, { method: 'DELETE' });
      setNotes((cur) => cur.filter((n) => n.id !== noteId));
    },
    [tripId],
  );

  useEffect(loadData, [loadData]);

  // On the routeplanner tab, trap the back gesture so it returns to the timeline
  // instead of leaving the trip page altogether.
  useEffect(() => {
    if (tab === 'plan') {
      window.history.pushState({ mmsPlan: true }, '');
      planPushedRef.current = true;
      const onPop = (e: PopStateEvent) => {
        // If popping returned to the mmsPlan state (e.g. after closing FlightSheet or PlaceSheet),
        // remain on the plan tab instead of switching to timeline.
        if (e.state?.mmsPlan) {
          return;
        }
        planPushedRef.current = false;
        setTab('timeline');
      };
      window.addEventListener('popstate', onPop);
      return () => window.removeEventListener('popstate', onPop);
    }
    // Left the planner via the tab button — consume the trapped history entry so
    // one back press doesn't just eat the phantom state.
    if (planPushedRef.current) {
      planPushedRef.current = false;
      window.history.back();
    }
  }, [tab]);

  const handleMapClick = useCallback(
    (lngLat: { lng: number; lat: number }) => {
      // On the planner tab a tap picks the location for the next stop.
      if (tab === 'plan') {
        setPlanPick({ lat: lngLat.lat, lng: lngLat.lng });
        return;
      }
      if (!addPointMode) return;
      setPendingPoint(lngLat);
      setPointTime((current) => current || defaultPointTime(trip));
    },
    [addPointMode, trip, tab],
  );

  /**
   * Long-press on the map: what to do with the line you pressed.
   *
   * Three answers, and which of them are on offer depends on what is actually
   * there: an automatically drawn stretch can be taken back, a planned leg can
   * be hidden (or shown again), and anything with a straight gap can be routed
   * over real roads. A yes/no box could only ever ask one of them.
   */
  const handleLongPress = useCallback(
    async (lngLat: { lng: number; lat: number }) => {
      if (!tripId || tab === 'plan' || !canEdit) return;
      const onDrawn = await api<{ near: boolean }>(
        `/trips/${tripId}/route-fill/near?lng=${lngLat.lng}&lat=${lngLat.lat}`,
      ).catch(() => ({ near: false }));
      const leg = nearestLeg(stops, lngLat);

      const choices: ChoiceOption[] = [];
      if (!onDrawn.near) {
        choices.push({
          id: 'draw',
          label: 'Route via wegen tekenen',
          hint: 'Vult het dichtstbijzijnde rechte stuk aan via de snelste weg.',
          primary: true,
        });
      }
      if (onDrawn.near) {
        choices.push({
          id: 'undraw',
          label: 'Getekende route wissen',
          hint: 'Alleen dit automatisch getekende stuk. Je eigen GPS blijft staan.',
          danger: true,
        });
      }
      if (leg) {
        choices.push(
          leg.hideLeg
            ? {
                id: 'show',
                label: `Lijn naar ${leg.name} terugzetten`,
                hint: 'De rechte lijn tussen deze twee stops komt terug.',
              }
            : {
                id: 'hide',
                label: `Lijn naar ${leg.name} verwijderen`,
                hint: 'De stop blijft staan; alleen de lijn ernaartoe verdwijnt.',
                danger: true,
              },
        );
      }
      if (choices.length === 0) return;

      const picked = await chooseModal({
        title: 'Deze lijn',
        body: 'Wat wil je met het stuk route dat je ingedrukt hield?',
        choices,
      });
      if (!picked) return;

      try {
        if (picked === 'draw') {
          await api(`/trips/${tripId}/route-fill`, {
            method: 'POST',
            body: { lat: lngLat.lat, lng: lngLat.lng },
          });
        } else if (picked === 'undraw') {
          await api(`/trips/${tripId}/route-fill?lng=${lngLat.lng}&lat=${lngLat.lat}`, {
            method: 'DELETE',
          });
        } else if (leg) {
          const next = picked === 'hide';
          setStops((cur) => cur.map((s) => (s.id === leg.id ? { ...s, hideLeg: next } : s)));
          await api(`/trips/${tripId}/stops/${leg.id}`, {
            method: 'PATCH',
            body: { hideLeg: next },
          });
        }
        reloadRoutes();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Dat lukte niet');
      }
    },
    [tripId, tab, canEdit, stops],
  );

  async function savePoint() {
    if (!tripId || !pendingPoint) return;
    try {
      await api(`/trips/${tripId}/points`, {
        method: 'POST',
        body: {
          latitude: pendingPoint.lat,
          longitude: pendingPoint.lng,
          recordedAt: new Date(pointTime).toISOString(),
        },
      });
      setPendingPoint(null);
      reloadRoutes();
      api<Waypoint[]>(`/trips/${tripId}/points`).then(setWaypoints).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Punt opslaan mislukt');
    }
  }

  async function leaveTrip() {
    if (!trip || !user) return;
    const ok = await confirmModal({
      title: 'Reis verlaten?',
      body: `Je verlaat "${trip.title}". Je kunt er altijd opnieuw op gezet worden.`,
      confirmLabel: 'Verlaten',
      danger: true,
    });
    if (!ok) return;
    await api(`/trips/${trip.id}/members/${user.id}`, { method: 'DELETE' });
    navigate('/');
  }

  // Animate the sheet out before unmounting so the blur/backdrop don't snap.
  const closePeople = useCallback(() => {
    setPeopleClosing(true);
    window.setTimeout(() => {
      setPeopleOpen(false);
      setPeopleClosing(false);
    }, 240);
  }, []);

  // Same trap for the "Mensen & delen" sheet: a back gesture should close
  // the sheet, not walk out of the trip.
  useEffect(() => {
    if (!peopleOpen || peopleClosing) return;
    window.history.pushState({ mmsPeople: true }, '');
    let popped = false;
    const onPop = () => {
      // A sheet above this one consuming its own entry, not a back gesture.
      if (popWasOurs()) return;
      popped = true;
      closePeople();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed with the ✕ instead — consume the entry we pushed.
      if (!popped) window.history.back();
    };
  }, [peopleOpen, peopleClosing, closePeople]);

  const toggleUser = useCallback((userId: string) => {
    setVisibleUsers((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  /**
   * Only travellers who actually put something on this map.
   *
   * A companion who never tracked and never added a photo has nothing to show
   * or hide, so offering them as a filter is a switch that does nothing.
   */
  const shownMembers = useMemo(() => {
    if (!trip) return [];
    const contributed = new Set<string>();
    for (const feature of routes?.features ?? []) {
      if (feature.geometry.coordinates.length > 0) contributed.add(feature.properties.userId);
    }
    for (const item of media) contributed.add(item.userId);
    for (const fix of liveFixes) contributed.add(fix.userId);
    return trip.members.filter((m) => contributed.has(m.userId));
  }, [trip, routes, media, liveFixes]);

  /**
   * Whose name the filter pill carries.
   *
   * Yours, when you are one of the travellers. On somebody else's trip you are
   * not: the pill said "Mark" beside a map with none of Mark on it, and offered
   * to switch him on. It now names the person whose route you came to look at.
   */
  const primaryMember =
    shownMembers.find((m) => m.userId === user?.id) ?? shownMembers[0] ?? null;

  // The day filter reaches the photos as well as the line: a day's map with
  // the whole trip's photos on it is not that day.
  // The stops that day covers. A stop's stay runs from its arrival to its
  // departure, so "which places was I in on this day" is a range test.
  const visibleStops = useMemo(
    () =>
      day === null
        ? stops
        : stops.filter((stop) => stop.arrivalDate <= day && day <= stop.departureDate),
    [stops, day],
  );

  const visibleMedia = useMemo(
    () =>
      media.filter(
        (m) => visibleUsers.has(m.userId) && (day === null || m.takenAt.slice(0, 10) === day),
      ),
    [media, visibleUsers, day],
  );

  // Your own "you are here" dot only belongs on a trip that is CURRENTLY running
  // (between start and end) — not on every past/future trip's map.
  const tripActive =
    !!trip &&
    trip.startDate.slice(0, 10) <= new Date().toISOString().slice(0, 10) &&
    new Date(trip.endDate).getTime() + 86_400_000 >= Date.now();

  // Animate the person dropdown out before it unmounts (mirrors the open pop).
  const togglePersonMenu = () => {
    if (personMenuOpen) {
      setPersonMenuClosing(true);
      window.setTimeout(() => {
        setPersonMenuOpen(false);
        setPersonMenuClosing(false);
      }, 150);
    } else {
      setPersonMenuOpen(true);
    }
  };

  // Keep the timeline in sync with the open photo: switch to the Tijdlijn tab
  // and scroll the matching thumbnail into view.
  const openPhoto = useCallback(
    (mediaId: string) => {
      const idx = visibleMedia.findIndex((m) => m.id === mediaId);
      if (idx === -1) return;
      setLightboxIndex(idx);
    },
    [visibleMedia],
  );

  const scrollTimelineTo = useCallback((mediaId: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-media-id="${mediaId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  // Arriving from a search result means "show me this photo", so the lightbox
  // opens on it as soon as the trip's media are in. The parameter is consumed
  // straight away, or closing the photo and reloading would reopen it.
  useEffect(() => {
    const wanted = searchParams.get('photo');
    if (!wanted) return;
    if (media.length === 0) return; // photos still on their way

    const item = media.find((m) => m.id === wanted);
    // Arriving from a search at somebody else's photo: their pictures are not
    // on screen yet, so the lightbox would have nothing to open. Switch that
    // traveller on and let the next pass find it.
    if (item && !visibleUsers.has(item.userId)) {
      setVisibleUsers((current) => new Set(current).add(item.userId));
      return;
    }
    // Same for a day filter left on: the photo may belong to another day.
    const index = visibleMedia.findIndex((m) => m.id === wanted);
    if (index < 0 && item && day !== null) {
      setDay(null);
      return;
    }
    if (index >= 0) setLightboxIndex(index);
    const next = new URLSearchParams(searchParams);
    next.delete('photo');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, visibleMedia, visibleUsers, media, day]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const item = visibleMedia[lightboxIndex];
    if (!item) return;
    scrollTimelineTo(item.id);
  }, [lightboxIndex, visibleMedia, scrollTimelineTo]);

  if (noAccess && tripId) return <TripAccessPage tripId={tripId} />;

  // Nothing until the trip itself has answered. Painting the map first meant a
  // trip you have no access to flashed its (empty) map for a moment before the
  // door closed in front of it.
  if (!trip && !error) return <main className="page trip-detail-wait" />;

  if (error) {
    return (
      <main className="page">
        <p className="error-text">{error}</p>
        <Link to="/" className="btn btn-ghost">
          <Icon name="arrow-left" size={16} /> Terug naar reizen
        </Link>
      </main>
    );
  }

  return (
    <main className="trip-detail fade-in" ref={scrollRef}>
      <div className="trip-map-panel card" ref={mapPanelRef}>
        <Link to="/" className="trip-fab trip-fab-back" aria-label="Alle reizen">
          <Icon name="arrow-left" size={20} />
        </Link>
        {trip && (
          <div className="trip-fabs">
            <button
              className="trip-fab"
              aria-label="Mensen & delen"
              onClick={() => setPeopleOpen(true)}
            >
              <Icon name="share" size={20} />
            </button>
            {trip.ownerId === user?.id && (
              <Link
                to={`/trips/${tripId}/settings`}
                className="trip-fab"
                aria-label="Reisinstellingen"
              >
                <Icon name="gear" size={20} />
              </Link>
            )}
          </div>
        )}
        <TripMap
          routes={routes}
          media={visibleMedia}
          // One day means that day's places too: the planner's line from stop
          // to stop was still drawing legs across countries nobody travelled
          // that day.
          stops={visibleStops}
          autoFit={day === null}
          // Hand-placed points are editing scaffolding: they belong in the
          // points editor, where you can drag them, not scattered over the
          // trip's own map.
          waypoints={addPointMode && canEdit ? waypoints : undefined}
          onWaypointDelete={addPointMode && canEdit ? deleteWaypoint : undefined}
          visibleUsers={visibleUsers}
          onMapClick={handleMapClick}
          onLongPress={handleLongPress}
          onSelfClick={canEdit ? () => setPointsOpen(true) : undefined}
          onPhotoOpen={openPhoto}
          onPhotoFocus={scrollTimelineTo}
          clickMode={addPointMode}
          styleUrl={getMapStyle()}
          // Shown whenever this trip is the one being tracked, so you can see
          // yourself move on its map.
          // Not on a trip you are only watching: your own blue dot at home,
          // hundreds of kilometres off somebody else's route, is noise.
          currentLocation={canEdit && (liveTracking || tripActive) ? currentLoc : null}
          liveFixes={liveFixes}
          selfUserId={user?.id}
          onReady={(api) => (mapApiRef.current = api)}
        />

        {/* Whether you are being tracked right now, at the top of the map. */}
        <div className="map-top-pills">
          {liveTracking && (
            <button
              className="live-badge"
              onClick={() =>
                currentLoc && mapApiRef.current?.flyTo(currentLoc.lng, currentLoc.lat, 13)
              }
              title="Ga naar mijn huidige locatie"
            >
              <span className="live-badge-dot" />
              Live
              {/* Green pin once a real fix has come in — grey while we're still
                  waiting for the first one. */}
              <Icon
                name="pin"
                size={13}
                className={`live-badge-go ${currentLoc ? 'has-fix' : ''}`}
              />
            </button>
          )}
        </div>

        {/* Bottom left, above the traveller picker: which day the map is
            showing, and whose route is on it. The picker is not always there,
            so the stack holds the gutter rather than the pill hanging off it. */}
        <div className="map-bottom-left">
          <DayFilter days={days} value={day} onChange={setDay} />

        {/* Also shown for a single traveller who isn't you — that is exactly the
            case (a friend's trip) where the pill has something to say. */}
        {trip && primaryMember && (shownMembers.length > 1 || primaryMember.userId !== user?.id) && (
          <div className="person-select">
            {personMenuOpen && (
              <div className={`person-select-menu card ${personMenuClosing ? 'closing' : ''}`}>
                {shownMembers.map((member) => {
                  const active = visibleUsers.has(member.userId);
                  const fix = liveFixes.find((f) => f.userId === member.userId);
                  const seen = fix ? lastSeenLabel(fix.recordedAt, liveTick) : null;
                  return (
                    <button
                      key={member.userId}
                      className={active ? 'active' : ''}
                      onClick={() => toggleUser(member.userId)}
                    >
                      <span
                        className="person-chip-dot"
                        style={{ background: colorForUser(member.userId) }}
                      />
                      <span className="person-select-name">
                        {member.user.displayName}
                        {member.userId === user?.id && ' (ik)'}
                      </span>
                      {/* Last known position, same wording as the map marker. */}
                      {seen && (
                        <span className={`person-seen ${seen.fresh ? 'fresh' : ''}`}>
                          {seen.text}
                        </span>
                      )}
                      <span className={`person-check ${active ? 'on' : ''}`}>
                        <Icon name="check" size={15} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <button
              className="person-select-btn"
              onClick={togglePersonMenu}
              aria-expanded={personMenuOpen}
            >
              <span
                className="person-chip-dot"
                style={{ background: colorForUser(primaryMember.userId) }}
              />
              <span className="person-select-name">{primaryMember.user.displayName}</span>
              {/* Stays mounted at zero width so the pill can GROW into the extra
                  count instead of snapping wider the moment you tick someone.
                  It keeps showing the last real number while collapsing — the
                  live count is 0 by then, and "+0" flashing past looks broken. */}
              <span className={`person-extra ${extraCount > 0 ? 'on' : ''}`}>
                <span key={shownExtra}>+{shownExtra}</span>
              </span>
              <Icon
                name="chevron-down"
                size={14}
                className={`person-select-caret ${personMenuOpen && !personMenuClosing ? 'open' : ''}`}
              />
            </button>
          </div>
        )}
        </div>

        {pendingPoint && (
          <div className="add-point-panel card">
            <strong>Punt toevoegen</strong>
            <span className="muted">
              {pendingPoint.lat.toFixed(5)}, {pendingPoint.lng.toFixed(5)}
            </span>
            <div className="field">
              <label htmlFor="pt-time">Tijdstip op de route</label>
              <input
                id="pt-time"
                type="datetime-local"
                value={pointTime}
                onChange={(e) => setPointTime(e.target.value)}
              />
            </div>
            <div className="add-point-actions">
              <button className="btn btn-ghost" onClick={() => setPendingPoint(null)}>
                Annuleren
              </button>
              <button className="btn btn-primary" onClick={savePoint} disabled={!pointTime}>
                Opslaan
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="trip-side" ref={sideRef}>
        <div className="sheet-grab" aria-hidden="true" />

        {/* Portalled out of the side column on purpose: that column sets its
            own z-index, which makes it a stacking context, and no z-index
            inside it can beat the map panel above. */}
        {/* Not while the people sheet is up: it is fixed to the viewport, so it
            floated over the sheet's scrim instead of with the page it belongs
            to. */}
        {backTopShown &&
          !peopleOpen &&
          createPortal(
          <button
            type="button"
            className={`trip-backtop ${backTopClosing ? 'leaving' : ''}`}
            aria-label="Terug naar boven"
            onClick={() => {
              // Long enough for the smooth scroll to land; the camera is set
              // once, at the end, so it actually stays on the whole trip.
              suppressFocus.current = Date.now() + 1200;
              // The grip is for aiming at the middle of a long list; on the way
              // back to the top there is nothing to aim at, and it chasing the
              // list up the screen was only ever in the way.
              window.dispatchEvent(new Event('mms:fastscroll-hide'));
              scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
              sideRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
              window.setTimeout(() => mapApiRef.current?.resetView(), 420);
            }}
          >
            <Icon name="chevron-down" size={20} />
          </button>,
          document.body,
        )}
        {/* One header block: cover photo, title, dates and the trip's numbers —
            rather than a photo followed by a row of separate stat boxes. */}
        {/* A trip without a photo gets what its card on the home page gets: its
            own colour and the compass. A blank panel with the numbers floating
            on it looked like a cover that had failed to load. */}
        <div
          className={`trip-headcard ${trip ? 'has-cover' : ''} ${
            trip && !trip.resolvedCoverId ? 'no-photo' : ''
          }`}
          style={trip && !trip.resolvedCoverId ? { background: tripCoverBg(trip) } : undefined}
        >
          {trip?.resolvedCoverId && (
            <AuthImage
              path={`/media/${trip.resolvedCoverId}/thumbnail`}
              alt=""
              className="trip-hero-img"
            />
          )}
          {trip && !trip.resolvedCoverId && (
            <span className="trip-headcard-glyph" data-glyph={tripGlyph(trip.title)} aria-hidden="true">
              <Icon
                name={tripGlyph(trip.title)}
                size={tripGlyphSize(trip.title, 130)}
                strokeWidth={tripGlyphStroke(trip.title)}
              />
            </span>
          )}
          <div className="trip-headcard-body">
            <h1>{trip?.title ?? '…'}</h1>
            {trip && (
              <p className="trip-headcard-dates">
                {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
              </p>
            )}
            {(
              <TripFacts
                facts={!stats ? [] : resolveFacts(
                  {
                    distanceKm: stats.distanceKm,
                    days: stats.days,
                    stops: countStopPlaces(stops),
                    photoCount: stats.photoCount,
                    travellers: trip?.members.length ?? 0,
                    countries: stats.countries.length,
                  },
                  (getTripFacts(tripId ?? '') as FactId[] | null) ?? null,
                )}
              />
            )}
          </div>
        </div>
        {trip?.description && <p>{trip.description}</p>}

        <div className="side-tabs" role="tablist" data-tab={tab}>
          {/* One pill that slides between the two, so switching reads as a
              movement rather than two separate repaints. */}
          <span className="side-tabs-thumb" aria-hidden="true" />
          <button
            className={tab === 'timeline' ? 'active' : ''}
            role="tab"
            aria-selected={tab === 'timeline'}
            onClick={() => setTab('timeline')}
          >
            Tijdlijn
          </button>
          <button
            className={tab === 'plan' ? 'active' : ''}
            role="tab"
            aria-selected={tab === 'plan'}
            onClick={() => setTab('plan')}
          >
            {canEdit ? 'Routeplanner' : 'Route'}
          </button>
        </div>

        {tab === 'timeline' ? (
          <Timeline
            media={visibleMedia}
            visibleUsers={visibleUsers}
            showOwner={(trip?.members.length ?? 0) > 1}
            onPhotoClick={(item) => setLightboxIndex(visibleMedia.indexOf(item))}
            notes={notes}
            canEditNotes={canEdit}
            emptyOwnerName={
              canEdit
                ? null
                : trip?.members.find((m) => m.userId === trip.ownerId)?.user.displayName ?? null
            }
            ownUserId={user?.id}
            onSaveNote={saveNote}
            onDeleteNote={deleteNote}
            stops={stops.map((s) => ({
              name: s.name,
              countryCode: s.countryCode,
              latitude: s.latitude,
              longitude: s.longitude,
              arrivalDate: s.arrivalDate,
              departureDate: s.departureDate,
            }))}
          />
        ) : (
          <TripPlanner
            tripId={tripId!}
            trip={trip}
            stops={stops}
            onStopsChange={setStops}
            onChanged={loadData}
            pickedCoords={planPick}
            onPickConsumed={() => setPlanPick(null)}
            onFlyTo={(lng, lat) => mapApiRef.current?.flyTo(lng, lat)}
            readOnly={!canEdit}
          />
        )}
      </aside>

      {peopleOpen && trip && (
        <div
          className={`people-sheet-backdrop ${peopleClosing ? 'closing' : ''}`}
          onClick={closePeople}
        >
          <div className="people-sheet card" onClick={(e) => e.stopPropagation()}>
            <div className="people-sheet-head">
              <h2>Mensen &amp; delen</h2>
              <button
                className="people-sheet-close"
                aria-label="Sluiten"
                onClick={closePeople}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <MembersPanel trip={trip} onChanged={loadData} />
            {/* Companions see the links too, so they can pass one on without
                asking the owner to send it again. Guests get nothing to hand
                out: they were invited to look, not to widen the audience. */}
            {canEdit && tripId && (
              <SharePanel tripId={tripId} ownerView={trip.ownerId === user?.id} />
            )}
            {/* Made from what this page already has in hand: the route, the
                stops and the photos. */}
            <SummaryPanel trip={trip} stops={stops} media={media} routes={routes} />
            {/* The other thing people want from a finished trip: all of it, in
                order, on paper. */}
            <PhotoBook trip={trip} stops={stops} media={media} notes={notes} />
            {/* Somebody put you on this trip; the way back off it belongs here,
                where the rest of "who is on this trip" lives. */}
            {trip.ownerId !== user?.id && (
              <button type="button" className="people-leave" onClick={leaveTrip}>
                Reis verlaten
              </button>
            )}
          </div>
        </div>
      )}

      {/* A trip of three months is a very long timeline; the grip throws it
          around by the day instead of by the flick. */}
      <FastScroll page={scrollRef} side={sideRef} />

      {lightboxIndex !== null && (
        <Lightbox
          items={visibleMedia}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          coverTripId={trip?.ownerId === user?.id ? tripId : undefined}
          onCoverSet={loadData}
        />
      )}

      {pointsOpen && tripId && (
        <TrackPointsEditor
          tripId={tripId}
          onClose={() => {
            setPointsOpen(false);
            // Points may have been dragged, added or removed — redraw the line.
            reloadRoutes();
          }}
        />
      )}
    </main>
  );
}

/**
 * Which planned leg the press landed on.
 *
 * A leg belongs to the stop it arrives at, so this returns that stop: the line
 * runs from the stop before it. Only route stops count (a day trip is a spur,
 * not a leg), and only within a sensible distance of the line itself, so a
 * press in the middle of the sea offers nothing.
 */
function nearestLeg(
  stops: PlannedStop[],
  at: { lng: number; lat: number },
): PlannedStop | null {
  const route = stops.filter((s) => !s.parentStopId);
  let best: { stop: PlannedStop; d: number } | null = null;
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1]!;
    const to = route[i]!;
    if (from.latitude === null || from.longitude === null) continue;
    if (to.latitude === null || to.longitude === null) continue;
    const d = pointToSegmentKm(
      [at.lng, at.lat],
      [from.longitude, from.latitude],
      [to.longitude, to.latitude],
    );
    if (!best || d < best.d) best = { stop: to, d };
  }
  // Generous, because a press lands wherever your thumb is, but not so wide
  // that any press on the map claims the nearest leg on the other side of it.
  return best && best.d <= 80 ? best.stop : null;
}

/** Distance from a point to a segment, in kilometres (flat approximation). */
function pointToSegmentKm(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const ky = 110.57;
  const kx = 111.32 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const px = p[0] * kx;
  const py = p[1] * ky;
  const ax = a[0] * kx;
  const ay = a[1] * ky;
  const dx = b[0] * kx - ax;
  const dy = b[1] * ky - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Default manual-point time: midday on the trip's first day, or now. */
function defaultPointTime(trip: Trip | null): string {
  const base = trip ? new Date(trip.startDate) : new Date();
  base.setHours(12, 0, 0, 0);
  return base.toISOString().slice(0, 16);
}
