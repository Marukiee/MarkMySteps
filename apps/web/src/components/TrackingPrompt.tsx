import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { isNative } from '../tracking/tracker';
import { onTrackerChange, startTracking, TrackerState } from '../tracking/tracker';
import './tracking-prompt.css';

const DISMISS_KEY = 'mms.trackprompt.dismissed';
const DAY = 86_400_000;

/**
 * Native-only nudge: when a trip is active (or starts within a day) and you
 * aren't tracking it yet, offer to start. Dismissable per trip.
 */
export function TrackingPrompt() {
  const { user } = useAuth();
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
          void startTracking(active.id);
        } else {
          setTrip(active);
        }
      })
      .catch(() => undefined);
  }, [user?.id]);

  if (!trip || tracker.tripId === trip.id) return null;
  if (localStorage.getItem(DISMISS_KEY) === trip.id) return null;

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
        <button className="primary" onClick={() => void startTracking(trip.id)}>
          Start tracking
        </button>
      </div>
    </div>
  );
}
