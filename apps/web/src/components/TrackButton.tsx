import { useEffect, useState } from 'react';
import {
  TrackerState,
  hasBackgroundLocation,
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
  // Only shown when "Allow all the time" is genuinely missing — the plugin
  // reports the real permission state, so this no longer claims something is
  // wrong when the setting is already correct.
  const [needsBackground, setNeedsBackground] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(
    () => localStorage.getItem('mms.perm.tip.dismissed') === '1',
  );

  useEffect(() => onTrackerChange(setTracker), []);

  useEffect(() => {
    let alive = true;
    void hasBackgroundLocation().then((ok) => alive && setNeedsBackground(!ok));
    return () => {
      alive = false;
    };
  }, [tracker.tripId]);

  const activeHere = tracker.tripId === tripId;

  function dismissTip() {
    localStorage.setItem('mms.perm.tip.dismissed', '1');
    setTipDismissed(true);
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
      {activeHere && isNative() && needsBackground && !tipDismissed && (
        <div className="track-perm-tip">
          <div className="track-perm-head">
            <span className="track-perm-icon">
              <Icon name="shield" size={17} />
            </span>
            <strong>Tracken stopt zodra je de app sluit</strong>
            <button
              type="button"
              className="track-perm-close"
              aria-label="Sluiten"
              onClick={dismissTip}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <span className="track-perm-text">
            Locatie staat op “Alleen tijdens gebruik van de app”. Zet hem op{' '}
            <b>Altijd toestaan</b> om je route ook met het scherm uit bij te houden.
          </span>
          <button
            type="button"
            className="track-perm-open"
            onClick={() => void openLocationSettings()}
          >
            Locatie-instellingen openen
          </button>
        </div>
      )}
    </>
  );
}
