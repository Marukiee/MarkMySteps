import { useEffect, useState, type ReactNode } from 'react';
import { haptic } from '../lib/haptics';
import './tapwhy.css';

/**
 * Something you cannot change here: shown grey, and only when tapped does it
 * say why, in a short note that eases in under it and goes again. Never a
 * standing warning on the page.
 */
export function TapWhy({
  locked,
  why,
  children,
  className = '',
}: {
  locked: boolean;
  why: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => setShown(false), 4200);
    return () => window.clearTimeout(id);
  }, [shown]);

  useEffect(() => {
    if (!locked) setShown(false);
  }, [locked]);

  return (
    <div
      className={`tap-why ${locked ? 'locked' : ''} ${className}`.trim()}
      aria-disabled={locked || undefined}
      onClickCapture={
        locked
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              haptic('end');
              setShown(true);
            }
          : undefined
      }
    >
      <div className="tap-why-body">{children}</div>
      <div className="tap-why-note" data-open={locked && shown} role="status">
        <span>{why}</span>
      </div>
    </div>
  );
}
