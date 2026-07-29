import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './helptip.css';

interface Placement {
  left: number;
  width: number;
  /** Anchored below the button (top) or above it (bottom). */
  top?: number;
  bottom?: number;
  above: boolean;
}

/**
 * Small "?" next to a title. Tapping it floats the explanation over the page
 * instead of pushing the layout apart; tapping anywhere else (or scrolling)
 * closes it again, with an animation in BOTH directions.
 */
export function HelpTip({ children, label = 'Uitleg' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [place, setPlace] = useState<Placement | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 160);
  };

  const show = () => {
    const button = btnRef.current;
    if (!button) return;
    const r = button.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
    // Flip above the button when there isn't room for a few lines below it.
    const above = r.bottom + 180 > window.innerHeight && r.top > 180;
    setPlace(
      above
        ? { left, width, bottom: window.innerHeight - r.top + 8, above }
        : { left, width, top: r.bottom + 8, above },
    );
    setOpen(true);
  };

  // Any scroll/resize moves the anchor out from under the bubble → close it.
  // A tap outside closes it too, watched from the document rather than through
  // a full-screen scrim: a scrim swallows the start of a swipe and then leaves
  // from under the finger, and the browser hands the whole accumulated delta to
  // the page at once — which is why scrolling with a tip open bolted away.
  useEffect(() => {
    if (!open || closing) return;
    const onScroll = () => close();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (popRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, closing]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`help-tip-btn ${open && !closing ? 'on' : ''}`}
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else show();
        }}
      >
        <Icon name="question" size={14} />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={popRef}
            className={`help-tip-pop card ${place.above ? 'above' : ''} ${closing ? 'closing' : ''}`}
            style={{
              left: place.left,
              width: place.width,
              ...(place.above ? { bottom: place.bottom } : { top: place.top }),
            }}
            role="tooltip"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
