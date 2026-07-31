import { Icon } from './Icon';
import './onboardingshots.css';

/**
 * The medallions on the onboarding slides, with something happening in them.
 *
 * Same shape and size as the icon that used to sit there, so the tour keeps the
 * layout it had. What is inside is built out of the app's own parts — the
 * numbered pins from the map, the photo grid from a day, the accent — and it
 * plays once as the slide arrives. A slide is remounted per step, so each one
 * starts from the beginning every time it is reached.
 */

/** Plan je route: pins landing one after another with the line drawn between. */
export function VisualRoute() {
  return (
    <span className="onb-visual onb-vis">
      <svg viewBox="0 0 100 100" className="vis-route" aria-hidden="true">
        <path
          className="vis-route-line"
          d="M22 76 C 36 68, 40 50, 52 46 S 74 38, 80 24"
          fill="none"
        />
        <circle className="vis-pin vis-pin-1" cx="22" cy="76" r="8" />
        <circle className="vis-pin vis-pin-2" cx="52" cy="46" r="7" />
        <circle className="vis-pin vis-pin-3" cx="80" cy="24" r="8" />
      </svg>
    </span>
  );
}

/** Je dagen: the photo grid of a day filling in, with the note under it. */
export function VisualDays() {
  return (
    <span className="onb-visual onb-vis">
      <span className="vis-days" aria-hidden="true">
        <span className="vis-tile vis-tile-1" />
        <span className="vis-tile vis-tile-2" />
        <span className="vis-tile vis-tile-3" />
        <span className="vis-tile vis-tile-4" />
        <span className="vis-note" />
      </span>
    </span>
  );
}

/** Delen: one link, going out to the people who stayed at home. */
export function VisualShare() {
  return (
    <span className="onb-visual onb-vis">
      <span className="vis-share" aria-hidden="true">
        <span className="vis-ripple" />
        <span className="vis-ripple vis-ripple-2" />
        <Icon name="share" size={44} />
      </span>
    </span>
  );
}

/** Zuinig en offline: points piling up while there is no signal, then away. */
export function VisualOffline() {
  return (
    <span className="onb-visual onb-vis">
      <span className="vis-offline" aria-hidden="true">
        <Icon name="cloud-off" size={38} />
        <span className="vis-buffer">
          <span />
          <span />
          <span />
        </span>
      </span>
    </span>
  );
}

/** Licht of donker: one disc, both halves of it. */
export function VisualTheme() {
  return (
    <span className="onb-visual onb-vis">
      <span className="vis-theme" aria-hidden="true">
        <span className="vis-theme-light">
          <Icon name="sun" size={26} />
        </span>
        <span className="vis-theme-dark">
          <Icon name="moon" size={26} />
        </span>
      </span>
    </span>
  );
}

/** Je vaste vliegvelden: a plane taking the bow the globe draws. */
export function VisualAirports() {
  return (
    <span className="onb-visual onb-vis">
      <svg viewBox="0 0 100 100" className="vis-fly" aria-hidden="true">
        <path className="vis-fly-arc" d="M18 72 Q 50 20, 82 44" fill="none" />
        <circle className="vis-fly-dot" cx="18" cy="72" r="5" />
        <circle className="vis-fly-dot vis-fly-dot-2" cx="82" cy="44" r="5" />
      </svg>
      <span className="vis-fly-plane">
        <Icon name="plane" size={22} />
      </span>
    </span>
  );
}
