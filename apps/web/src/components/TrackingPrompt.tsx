import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { isNative } from '../tracking/tracker';
import { onTrackerChange, startTracking, TrackerState } from '../tracking/tracker';
import './tracking-prompt.css';

const DISMISS_KEY = 'mms.trackprompt.dismissed';
const DAY = 86_400_000;

/**
 * When a trip that tracks itself may actually start.
 *
 * Not on the day it begins: a trip that opens with a flight begins in a
 * departure hall and then in the air, where a phone reports a scatter of fixes
 * hundreds of kilometres apart and the route comes out as a mess. The first
 * place you STAY is where the trip becomes a thing you can follow, so tracking
 * waits for the day you arrive there.
 *
 * A trip with no planned stops has nothing to wait for and starts as before.
 */
async function startWhenThere(trip: Trip, now: number): Promise<void> {
  try {
    const stops = await api<{ arrivalDate: string; nights: number; parentStopId?: string | null }[]>(
      `/trips/${trip.id}/stops`,
    );
    const firstStay = stops.find((s) => !s.parentStopId && s.nights > 0);
    if (firstStay) {
      const arrival = new Date(firstStay.arrivalDate);
      arrival.setHours(0, 0, 0, 0);
      if (now < arrival.getTime()) return;
    }
  } catch {
    /* no plan to read: fall through and track as before */
  }
  void startTracking(trip.id);
}

/**
 * Native-only nudge: when a trip is active (or starts within a day) and you
 * aren't tracking it yet, offer to start. Dismissable per trip.
 */
export function TrackingPrompt() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [tracker, setTracker] = useState<TrackerState>({
    tripId: null,
    buffered: 0,
    lastError: null,
    lastFix: null,
    lastStatus: null,
  });

  useEffect(() => onTrackerChange(setTracker), []);

  useEffect(() => {
    if (!isNative()) return;
    api<Trip[]>('/trips')
      .then((trips) => {
        const now = Date.now();
        const active = trips.find((t) => {
          const start = new Date(t.startDate).getTime();
          const end = new Date(t.endDate).getTime() + DAY;
          return now >= start - DAY && now <= end;
        });
        if (!active) return;
        // Guests / members without tracking permission are never nudged.
        const me = active.members.find((m) => m.userId === user?.id);
        const canTrack = !!me && (me.role === 'OWNER' || (me.role === 'MEMBER' && me.canTrack));
        if (!canTrack) return;
        // autoTrack trips start silently once begun; others show the prompt.
        if (active.autoTrack && now >= new Date(active.startDate).getTime()) {
          void startWhenThere(active, now);
        } else {
          setTrip(active);
        }
      })
      .catch(() => undefined);
  }, [user?.id]);

  if (!trip || tracker.tripId === trip.id) return null;
  if (localStorage.getItem(DISMISS_KEY) === trip.id) return null;
  // It is an offer about the trip list you are looking at. Open a trip, the
  // planner or the settings and it has nothing to say there — it used to
  // follow you around the whole app.
  if (pathname !== '/') return null;

  // It slid up on arrival and then simply ceased to exist on Later. It leaves
  // the way it came now, which is also what says the tap was registered.
  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, trip.id);
    setLeaving(true);
    window.setTimeout(() => {
      setTrip(null);
      setLeaving(false);
    }, 240);
  };

  return (
    <div className={`track-prompt ${leaving ? 'leaving' : ''}`}>
      <div>
        <strong>{trip.title}</strong> is bezig. Route bijhouden?
      </div>
      <div className="track-prompt-actions">
        <button onClick={dismiss}>Later</button>
        <button
          className="primary"
          onClick={() => {
            // Leaves the same way "Later" does; it used to blink out the
            // moment the tracker reported the trip as its own.
            setLeaving(true);
            void startTracking(trip.id);
          }}
        >
          Start tracking
        </button>
      </div>
    </div>
  );
}
