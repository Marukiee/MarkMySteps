import { Icon } from './Icon';
import './onboardingshots.css';

/**
 * The pictures on the onboarding slides.
 *
 * They are small screenshots rather than icons: the same trip cards, the same
 * chips, the same share link you meet a minute later, drawn in CSS at a size
 * that fits above a heading. Each one plays once as its slide arrives — a slide
 * is remounted per step, so it starts from the beginning every time.
 *
 * An icon in a rounded square named a feature. This shows it.
 */

/** Je reizen terugkijken: the trip list, cards arriving with their facts. */
export function VisualTrips() {
  return (
    <span className="onb-shot" aria-hidden="true">
      <span className="shot-top">
        <span className="shot-top-title" />
      </span>
      <span className="shot-card shot-card-1">
        <span className="shot-card-name" />
        <span className="shot-chips">
          <i />
          <i />
          <i />
        </span>
      </span>
      <span className="shot-card shot-card-2">
        <span className="shot-card-name" />
        <span className="shot-chips">
          <i />
          <i />
        </span>
      </span>
    </span>
  );
}

/** Delen: the private link, and the people it goes out to. */
export function VisualShare() {
  return (
    <span className="onb-shot" aria-hidden="true">
      <span className="shot-top">
        <span className="shot-top-title" />
      </span>
      <span className="shot-link">
        <Icon name="lock" size={12} />
        <span className="shot-link-url" />
      </span>
      <span className="shot-readers">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** Zuinig en offline: no signal, and the app carrying on regardless. */
export function VisualOffline() {
  return (
    <span className="onb-visual onb-vis" aria-hidden="true">
      <span className="vis-offline">
        <Icon name="cloud-off" size={44} />
      </span>
    </span>
  );
}

/** Licht of donker: the same screen, both ways round. */
export function VisualTheme() {
  return (
    <span className="onb-shot onb-shot-theme" aria-hidden="true">
      <span className="shot-half shot-half-light">
        <span className="shot-mini-bar" />
        <span className="shot-mini-card" />
        <span className="shot-mini-line" />
        <span className="shot-mini-line short" />
      </span>
      <span className="shot-half shot-half-dark">
        <span className="shot-mini-bar" />
        <span className="shot-mini-card" />
        <span className="shot-mini-line" />
        <span className="shot-mini-line short" />
      </span>
    </span>
  );
}

/**
 * Je vaste vliegvelden: a plane taking the bow the globe draws.
 *
 * The plane used to be an HTML span next to the drawing, flown by hand-written
 * pixel offsets that had nothing to do with the curve — it cut the corner and
 * landed beside the second airport. It is inside the drawing now, stepping
 * along the very curve that is stroked, at the angle the curve has there.
 */
export function VisualAirports() {
  return (
    <span className="onb-visual onb-vis" aria-hidden="true">
      <svg viewBox="0 0 100 100" className="vis-fly">
        <path className="vis-fly-arc" d="M18 72 Q 50 20, 82 44" fill="none" />
        <circle className="vis-fly-dot" cx="18" cy="72" r="5" />
        <circle className="vis-fly-dot vis-fly-dot-2" cx="82" cy="44" r="5" />
        {/* Drawn around its own origin, nose along +x, so a translate puts it
            on the curve and a rotate turns it into the curve's direction. */}
        <path className="vis-fly-plane" d="M9 0 L-6 -5.5 L-3 0 L-6 5.5 Z" />
      </svg>
    </span>
  );
}

/** Aan de slag: the empty list, with the button that fills it. */
export function VisualStart() {
  return (
    <span className="onb-shot" aria-hidden="true">
      <span className="shot-top">
        <span className="shot-top-title" />
      </span>
      <span className="shot-new">
        <Icon name="plus" size={18} />
      </span>
      <span className="shot-new-label" />
    </span>
  );
}
