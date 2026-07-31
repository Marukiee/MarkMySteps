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
  return (
    <ul className="onb-plan" aria-hidden="true">
      {stops.map((stop, i) => (
        <li key={stop.name} style={{ animationDelay: `${0.25 + i * 0.4}s` }}>
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

/**
 * Zuinig en offline: a battery that hardly moves.
 *
 * The charge creeps down a sliver, over and over, next to the crossed-out
 * cloud that says none of this needs a signal. Both claims the slide makes,
 * shown rather than lettered.
 */
export function VisualOffline() {
  return (
    <span className="onb-shot onb-shot-power" aria-hidden="true">
      <span className="shot-battery">
        <span className="shot-battery-fill" />
        <span className="shot-battery-cap" />
      </span>
      <span className="shot-power-row">
        <Icon name="cloud-off" size={16} />
        <span className="shot-power-label" />
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
 * Je vaste vliegvelden: a plane crossing the slide, airport to airport.
 *
 * No frame around it. It flies the full width, laying its dotted track behind
 * it, from the dot it left to the dot it is heading for.
 */
export function VisualAirports() {
  return (
    <span className="onb-fly" aria-hidden="true">
      <svg viewBox="0 0 260 60" className="fly-svg">
        <path className="fly-track" d="M18 42 C 80 42, 120 20, 242 20" fill="none" />
        <circle className="fly-dot" cx="18" cy="42" r="5" />
        <circle className="fly-dot fly-dot-2" cx="242" cy="20" r="5" />
        {/* Drawn around its own origin, nose along +x, so a translate puts it
            on the track and a rotate turns it into the track's direction. */}
        <path className="fly-plane" d="M11 0 L-7 -6.5 L-3.5 0 L-7 6.5 Z" />
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
 * Begin je eerste reis: the home screen as it looks with nothing on it yet —
 * the empty-state card and the "+ Nieuwe reis" tile that follows it, which is
 * exactly the tap the tour is handing over to.
 */
export function VisualStart() {
  return (
    <span className="onb-shot onb-shot-start" aria-hidden="true">
      <span className="shot-top">
        <span className="shot-top-title" />
      </span>
      <span className="shot-empty">
        <span className="shot-empty-line" />
        <span className="shot-empty-line short" />
      </span>
      <span className="shot-new">
        <Icon name="plus" size={14} />
        <span className="shot-new-label" />
      </span>
    </span>
  );
}
