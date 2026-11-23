import { useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { t } from '../i18n';

/**
 * Fewer, the count, more: a connected button group as Material 3 Expressive
 * draws it. Round on the outside, tight (6px) where the pieces meet; the side
 * you press rounds further (to 20px) and back when let go. The number rolls
 * up for more and down for fewer.
 */
export function NightsStepper({ nights, onStep }: { nights: number; onStep: (by: number) => void }) {
  const last = useRef(nights);
  const dir = nights > last.current ? 'up' : nights < last.current ? 'down' : '';
  useEffect(() => {
    last.current = nights;
  }, [nights]);
  return (
    <div className="nights-group" role="group" aria-label={t('planner.nightsUnit', { count: nights })}>
      <button
        type="button"
        className="nights-side nights-minus"
        onClick={() => onStep(-1)}
        aria-label={t('planner.fewerNights')}
      >
        <Icon name="minus" size={16} strokeWidth={2.4} />
      </button>
      <span className="nights-value" aria-live="polite">
        <span key={nights} className={`nights-roll ${dir}`}>
          <strong>{nights}</strong>
          <small>{t('planner.nightsUnit', { count: nights })}</small>
        </span>
      </span>
      <button
        type="button"
        className="nights-side nights-plus"
        onClick={() => onStep(1)}
        aria-label={t('planner.moreNights')}
      >
        <Icon name="plus" size={16} strokeWidth={2.4} />
      </button>
    </div>
  );
}
