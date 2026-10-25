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
import { t } from '../i18n';
import { tr } from '../i18n/rich';
import { Icon } from './Icon';
import { alwaysLabel, whileUsingLabel } from '../lib/native';

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
            <Icon key="stop" name="stop" size={15} className="track-btn-icon" /> {t('trip.tracking.stop')}
          </>
        ) : (
          <>
            <Icon key="play" name="play" size={15} className="track-btn-icon" /> {t('trip.tracking.start')}
          </>
        )}
      </button>
      {activeHere && !isNative() && (
        <p className="muted">{t('trip.tracking.browserOnly')}</p>
      )}
      {activeHere && tracker.lastError && <p className="error-text">{tracker.lastError}</p>}
      {activeHere && isNative() && needsBackground && !tipDismissed && (
        <div className="track-perm-tip">
          <div className="track-perm-head">
            <span className="track-perm-icon">
              <Icon name="shield" size={17} />
            </span>
            <strong>{t('trip.tracking.permTitle')}</strong>
            <button
              type="button"
              className="track-perm-close"
              aria-label={t('common.close')}
              onClick={dismissTip}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <span className="track-perm-text">
            {tr(
              'trip.tracking.permText',
              { b: (s) => <b>{s}</b> },
              { whileUsing: whileUsingLabel(), always: alwaysLabel() },
            )}
          </span>
          <button
            type="button"
            className="track-perm-open"
            onClick={() => void openLocationSettings()}
          >
            {t('trip.tracking.openLocationSettings')}
          </button>
        </div>
      )}
    </>
  );
}
