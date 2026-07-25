import { useEffect, useState } from 'react';
import {
  TrackerState,
  isNative,
  onTrackerChange,
  openLocationSettings,
  startTracking,
  stopTracking,
} from '../tracking/tracker';
import { Icon } from './Icon';

export function TrackButton({ tripId }: { tripId: string }) {
  const [tracker, setTracker] = useState<TrackerState>({
    tripId: null,
    buffered: 0,
    lastError: null,
    lastFix: null,
    lastStatus: null,
  });
  // Android can't tell us "Always" vs "While using" without extra permissions,
  // so instead of a false detection we show a one-time reminder while tracking:
  // on "While using" the background service silently stops when the app closes.
  const [permTip, setPermTip] = useState(
    () => localStorage.getItem('mms.perm.tip.dismissed') !== '1',
  );

  useEffect(() => onTrackerChange(setTracker), []);

  const activeHere = tracker.tripId === tripId;

  function dismissTip() {
    localStorage.setItem('mms.perm.tip.dismissed', '1');
    setPermTip(false);
  }

  return (
    <>
      <button
        className={`btn ${activeHere ? 'btn-danger' : 'btn-ghost'}`}
        onClick={() => (activeHere ? void stopTracking() : void startTracking(tripId))}
      >
        {activeHere ? (
          <>
            <Icon key="stop" name="stop" size={15} className="track-btn-icon" /> Stop tracking
          </>
        ) : (
          <>
            <Icon key="play" name="play" size={15} className="track-btn-icon" /> Start tracking
          </>
        )}
      </button>
      {activeHere && !isNative() && (
        <p className="muted">Browser: alleen met scherm aan.</p>
      )}
      {activeHere && tracker.lastError && <p className="error-text">{tracker.lastError}</p>}
      {activeHere && isNative() && permTip && (
        <div className="track-perm-tip">
          <Icon name="shield" size={18} className="track-perm-icon" />
          <div className="track-perm-body">
            <strong>Werkt tracken op de achtergrond?</strong>
            <span>
              Zet locatie voor MarkMySteps op <b>Altijd toestaan</b>. Op “Alleen tijdens gebruik van
              de app” stopt het volgen zodra je de app sluit.
            </span>
            <button type="button" className="track-perm-open" onClick={() => void openLocationSettings()}>
              Locatie-instellingen openen
            </button>
          </div>
          <button
            type="button"
            className="track-perm-close"
            aria-label="Sluiten"
            onClick={dismissTip}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
    </>
  );
}
