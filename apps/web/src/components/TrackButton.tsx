import { useEffect, useState } from 'react';
import {
  TrackerState,
  isNative,
  onTrackerChange,
  startTracking,
  stopTracking,
} from '../tracking/tracker';

export function TrackButton({ tripId }: { tripId: string }) {
  const [tracker, setTracker] = useState<TrackerState>({
    tripId: null,
    buffered: 0,
    lastError: null,
  });

  useEffect(() => onTrackerChange(setTracker), []);

  const activeHere = tracker.tripId === tripId;

  return (
    <>
      <button
        className={`btn ${activeHere ? 'btn-danger' : 'btn-ghost'}`}
        onClick={() => (activeHere ? void stopTracking() : void startTracking(tripId))}
      >
        {activeHere ? '■ Stop tracking' : '● Start tracking'}
      </button>
      {activeHere && (
        <p className="muted">
          Tracking actief{isNative() ? '' : ' (browser: alleen met scherm aan)'}
          {tracker.buffered > 0 && ` · ${tracker.buffered} punten in buffer`}
          {tracker.lastError && ` · ${tracker.lastError}`}
        </p>
      )}
    </>
  );
}
