import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MediaItem } from '../api/types';
import { popWasOurs, skipNextPop } from '../lib/backStack';
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
      if (popWasOurs()) return;
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

/**
 * The poster, as big as the screen will allow.
 *
 * A series is held whole and swiped through here rather than one page being
 * lifted out of it: pulling a single page out of a strip that redraws itself
 * on every change is how the wrong page ended up on screen.
 */
export function SummaryPageViewer({
  pages,
  start,
  onClose,
}: {
  pages: RenderedPage[];
  start: number;
  onClose: () => void;
}) {
  const { closing, close } = useDismiss(onClose);
  const [at, setAt] = useState(start);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const child = strip?.children[start] as HTMLElement | undefined;
    if (child) strip!.scrollLeft = child.offsetLeft;
  }, [start]);

  return createPortal(
    <div className={`summary-viewer ${closing ? 'closing' : ''}`} onClick={close}>
      <button className="summary-viewer-close" aria-label="Sluiten" onClick={close}>
        <Icon name="close" size={20} />
      </button>
      <div
        className="summary-viewer-strip"
        ref={stripRef}
        onClick={(e) => e.stopPropagation()}
        onScroll={(e) => {
          const strip = e.currentTarget;
          setAt(Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth)));
        }}
      >
        {pages.map((page, i) => (
          <img key={page.url} src={page.url} alt={`Pagina ${i + 1}`} />
        ))}
      </div>
      {pages.length > 1 && (
        <span className="summary-viewer-count">
          {Math.min(at + 1, pages.length)} / {pages.length}
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

  /**
   * A window around the one you tapped, not the whole trip.
   *
   * Three hundred tiles is three hundred fetches and a grid the browser
   * repaints in pieces — which is the tearing you saw. The photo you want is
   * near the one you pressed, so that is what is offered.
   */
  const centre = Math.max(0, photos.findIndex((p) => p.id === current));
  const from = Math.max(0, centre - 60);
  const shown = photos.slice(from, from + 120);

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
          {shown.map((item) => (
            <button
              key={item.id}
              ref={item.id === current ? currentRef : undefined}
              type="button"
              className={`summary-swap-photo ${item.id === current ? 'current' : ''}`}
              onClick={() => {
                // Hand the choice over and then leave the same way as every
                // other dismissal: picking one used to make the sheet vanish
                // without an exit at all.
                onPick(item.id);
                close();
              }}
            >
              <AuthImage path={`/media/${item.id}/thumbnail`} alt="" className="summary-photo-img" />
            </button>
          ))}
          {shown.length === 0 && <p className="muted">Geen foto’s in deze periode.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
