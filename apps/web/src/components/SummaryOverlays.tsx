import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MediaItem } from '../api/types';
import { skipNextPop } from '../lib/backStack';
import { formatDay } from '../lib/colors';
import type { RenderedPage } from '../lib/summary/render';
import { AuthImage } from './AuthImage';
import { Icon } from './Icon';

/**
 * Closes on a back gesture as well as on the cross, and animates either way.
 *
 * Both overlays here sit on top of the maker, which itself sits on top of the
 * mensen & delen sheet, and each of those traps back for itself. The entry
 * this pushes is consumed on the way out, and the layers below are told to
 * ignore that pop — see backStack.
 */
function useDismiss(onClose: () => void, ms = 240): { closing: boolean; close: () => void } {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, ms);
  };
  useEffect(() => {
    window.history.pushState({ mmsOverlay: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      close();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) {
        skipNextPop();
        window.history.back();
      }
    };
    // Mounted once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { closing, close };
}

/** One page of the poster, as big as the screen will allow. */
export function SummaryPageViewer({
  page,
  index,
  total,
  onClose,
}: {
  page: RenderedPage;
  index: number;
  total: number;
  onClose: () => void;
}) {
  const { closing, close } = useDismiss(onClose);
  return createPortal(
    <div className={`summary-viewer ${closing ? 'closing' : ''}`} onClick={close}>
      <button className="summary-viewer-close" aria-label="Sluiten" onClick={close}>
        <Icon name="close" size={20} />
      </button>
      <img src={page.url} alt={`Pagina ${index + 1}`} onClick={(e) => e.stopPropagation()} />
      {total > 1 && (
        <span className="summary-viewer-count">
          {index + 1} / {total}
        </span>
      )}
    </div>,
    document.body,
  );
}

/**
 * Pick a different photograph for one slot.
 *
 * Opens on the one that is in the slot now, so what you see first is the rest
 * of that afternoon rather than the beginning of the trip — the photo you
 * actually want is nearly always a few frames either side of the one you
 * tapped.
 */
export function SummaryPhotoSwap({
  photos,
  current,
  onClose,
  onPick,
}: {
  photos: MediaItem[];
  current: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const { closing, close } = useDismiss(onClose, 220);
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  return createPortal(
    <div className={`summary-swap-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <div className="summary-swap card" onClick={(e) => e.stopPropagation()}>
        <div className="summary-swap-head">
          <h3>Andere foto</h3>
          <button className="people-sheet-close" aria-label="Sluiten" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="summary-swap-grid">
          {photos.map((item) => (
            <button
              key={item.id}
              ref={item.id === current ? currentRef : undefined}
              type="button"
              className={`summary-swap-photo ${item.id === current ? 'current' : ''}`}
              onClick={() => onPick(item.id)}
            >
              <AuthImage path={`/media/${item.id}/thumbnail`} alt="" className="summary-photo-img" />
              <span>{formatDay(item.takenAt)}</span>
            </button>
          ))}
          {photos.length === 0 && <p className="muted">Geen foto’s in deze periode.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
