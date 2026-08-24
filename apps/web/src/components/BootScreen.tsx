import { useEffect, useState } from 'react';
import { LogoMark } from './Logo';
import './bootscreen.css';

/**
 * Below this the app is simply starting, and a spinner is noise.
 *
 * Raised from 1200: a normal launch was landing just past it, so the screen
 * came up for a third of a second and left again. A flash of "this is taking
 * a while" on a launch that took no time is worse than no screen at all.
 */
const SLOW_MS = 2000;

/**
 * The screen for a launch that is taking its time.
 *
 * Getting to the home screen means asking the server who you are, and on a bad
 * connection that can take a while. The app used to render nothing at all
 * while it waited: a blank page for several seconds, which reads as a crash
 * rather than as work in progress.
 *
 * It still renders nothing for the first second or so — a launch that is quick
 * should not flash a spinner on its way past — and only says something once it
 * is late enough to be worth saying.
 */
export function BootScreen({ closing = false }: { closing?: boolean }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Once it is up it stays up until the app is in, even for the last frames of
  // a boot that turned out to be nearly done: appearing and disappearing in
  // the same breath is worse than either.
  if (!slow && !closing) return null;

  return (
    <div className={`boot-screen ${closing ? 'closing' : ''}`} role="status" aria-live="polite">
      <span className="boot-compass">
        <LogoMark size={78} spin />
      </span>
      <p className="boot-text">Dit duurt langer dan verwacht...</p>
    </div>
  );
}
