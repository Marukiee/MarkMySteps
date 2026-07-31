import { Icon, IconName } from './Icon';
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

/**
 * Plan je route: the itinerary as the planner lists it, under the globe that
 * is drawing the same route. Rows land in travel order, so the list is being
 * written while the map fills in.
 */
export function PlanItinerary({
  stops,
}: {
  stops: { name: string; nights: number; mode: string }[];
}) {
  // The last two swap places once the list has landed: dragging a stop into a
  // different order is half of what planning a route is, and a list that only
  // appeared did not say that.
  const swapA = stops.length - 2;
  const swapB = stops.length - 1;
  return (
    <ul className="onb-plan" aria-hidden="true">
      {stops.map((stop, i) => (
        <li
          key={stop.name}
          className={i === swapA ? 'onb-plan-down' : i === swapB ? 'onb-plan-up' : ''}
          style={{ animationDelay: `${0.12 + i * 0.13}s` }}
        >
          <span className="onb-plan-num">{i + 1}</span>
          <span className="onb-plan-name">{stop.name}</span>
          <span className="onb-plan-nights">{stop.nights} nachten</span>
          <span className="onb-plan-mode">
            <Icon name={stop.mode as IconName} size={13} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Je reizen terugkijken: the trip list, cards arriving with their facts. */
export function VisualTrips() {
  // Four, as a filled-in account looks — two read as a list that had barely
  // started. Colours are the app's own trip swatches.
  const cards = ['#e8613c', '#2a8f85', '#5a6ee1', '#e0993a'];
  return (
    <span className="onb-shot onb-shot-trips" aria-hidden="true">
      <span className="shot-top">
        <span className="shot-top-title" />
      </span>
      <span className="shot-grid">
        {cards.map((color, i) => (
          <span
            key={color}
            className="shot-card"
            style={{ background: color, animationDelay: `${0.15 + i * 0.16}s` }}
          >
            <span className="shot-card-name" />
            <span className="shot-chips">
              <i style={{ animationDelay: `${0.4 + i * 0.16}s` }} />
              <i style={{ animationDelay: `${0.48 + i * 0.16}s` }} />
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Delen: a link being made, and the password you can put on it.
 *
 * The address types itself out the way the panel fills it in after the tap,
 * and then the lock closes over it — the two halves of what sharing is here.
 */
export function VisualShare() {
  return (
    <span className="onb-shot onb-shot-share" aria-hidden="true">
      <span className="shot-make">
        <Icon name="share" size={13} />
        <span className="shot-make-label" />
      </span>
      <span className="shot-url">
        <span className="shot-url-text">markmysteps.nl/s/</span>
        <span className="shot-url-slug">7fQ2xd91</span>
      </span>
      <span className="shot-pass">
        <Icon name="lock" size={12} />
        <span className="shot-pass-dots">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
    </span>
  );
}

/**
 * Zuinig en offline: a battery against a clock.
 *
 * A charge that creeps down a sliver says nothing on its own — it needs
 * something to say how long that took. The hand goes round while the battery
 * barely moves, which is the whole claim of the slide in one picture.
 */
export function VisualOffline() {
  return (
    <span className="onb-shot onb-shot-power" aria-hidden="true">
      <span className="shot-battery">
        <span className="shot-battery-fill" />
        <span className="shot-battery-cap" />
        <span className="shot-battery-bolt">
          <Icon name="bolt" size={16} />
        </span>
      </span>
      <span className="shot-clock">
        <span className="shot-clock-hand shot-clock-hour" />
        <span className="shot-clock-hand shot-clock-minute" />
        <span className="shot-clock-pin" />
      </span>
    </span>
  );
}

/**
 * Licht of donker: one screen, with the dark one sweeping across it.
 *
 * Two halves standing side by side showed the two themes but never the
 * switch. The dark screen lies exactly over the light one and is revealed from
 * the left: all light, half and half, all dark, and back again.
 */
export function VisualTheme() {
  const screen = (
    <>
      <span className="shot-mini-bar" />
      <span className="shot-mini-card" />
      <span className="shot-mini-line" />
      <span className="shot-mini-line short" />
    </>
  );
  return (
    <span className="onb-shot onb-shot-theme" aria-hidden="true">
      <span className="shot-screen shot-screen-light">{screen}</span>
      <span className="shot-screen shot-screen-dark">{screen}</span>
    </span>
  );
}

/**
 * Je vaste vliegvelden: a plane crossing the slide, airport to airport.
 *
 * No frame around it. It flies the full width, laying its dotted track behind
 * it, from the dot it left to the dot it is heading for.
 */
export function VisualAirports() {
  return (
    <span className="onb-fly" aria-hidden="true">
      <svg viewBox="0 0 260 64" className="fly-svg">
        <path className="fly-track" d="M18 52 C 90 52, 140 12, 242 8" fill="none" />
        {/* Both airports stand there from the start: you have them before you
            fly, and one appearing halfway read as the plane creating it. */}
        <circle className="fly-dot" cx="18" cy="52" r="5" />
        <circle className="fly-dot" cx="242" cy="8" r="5" />
        {/* A plane seen from above, drawn symmetrically about its own spine —
            the app's banking silhouette leans, which reads as a mistake once
            it is being turned into the angle of a curve. Nose up in its own
            coordinates, turned a quarter so it runs along +x. */}
        <g className="fly-plane">
          <g transform="rotate(90) translate(-12 -12)">
            <path d="M12 1.6c1.05 0 1.7 1.5 1.7 3.4v3.6l8.6 5v2.4l-8.6-2.8v4.4l3.1 2.1v2l-4.8-1.5-4.8 1.5v-2l3.1-2.1v-4.4l-8.6 2.8v-2.4l8.6-5V5c0-1.9.65-3.4 1.7-3.4Z" />
          </g>
        </g>
      </svg>
    </span>
  );
}

/**
 * Meldingen: the two the app actually sends, sliding in one after the other.
 *
 * They look like the notification the tracker posts, because that is what they
 * are — an icon, a title and a line, on a card that arrives from the top.
 */
export function VisualNotifs() {
  return (
    <span className="onb-shot onb-shot-notifs" aria-hidden="true">
      <span className="shot-notif shot-notif-1">
        <span className="shot-notif-icon">
          <Icon name="pin" size={13} />
        </span>
        <span className="shot-notif-lines">
          <i />
          <i className="short" />
        </span>
      </span>
      <span className="shot-notif shot-notif-2">
        <span className="shot-notif-icon">
          <Icon name="people" size={13} />
        </span>
        <span className="shot-notif-lines">
          <i />
          <i className="short" />
        </span>
      </span>
    </span>
  );
}

/**
 * Begin je eerste reis: the "Nieuwe reis" form, exactly as it stands on the
 * home page — a title, a from and a to, and the button that makes it real.
 * The title types itself in, the dates fill, the button lights up.
 */
export function VisualStart() {
  return (
    <span className="onb-shot onb-shot-start" aria-hidden="true">
      <span className="shot-field">
        <span className="shot-field-label">Naam</span>
        <span className="shot-field-box">
          <span className="shot-typed">Interrail</span>
          <span className="shot-caret" />
        </span>
      </span>
      <span className="shot-dates">
        <span className="shot-field">
          <span className="shot-field-label">Van</span>
          <span className="shot-field-box shot-field-fill shot-fill-1" />
        </span>
        <span className="shot-field">
          <span className="shot-field-label">Tot</span>
          <span className="shot-field-box shot-field-fill shot-fill-2" />
        </span>
      </span>
      <span className="shot-submit">Aanmaken</span>
    </span>
  );
}
