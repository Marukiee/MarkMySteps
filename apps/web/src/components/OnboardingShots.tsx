import { ReactNode } from 'react';
import { Icon, IconName } from './Icon';
import './onboardingshots.css';

/**
 * Miniature app screens for the onboarding tour.
 *
 * Built out of the app's own tokens rather than pasted-in screenshots: a
 * screenshot is out of date the moment a colour or a radius changes, is wrong
 * in whichever theme it was not taken in, and has to ship as an asset per
 * screen size. These are the real surfaces at a smaller scale, so they follow
 * light/dark, the accent, and every later change to the design by themselves.
 */
export function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="shot-phone" aria-hidden="true">
      <div className="shot-phone-screen">{children}</div>
    </div>
  );
}

/** Head of a mock screen: the app's top bar, with a title and a back chevron. */
function ShotBar({ title, action }: { title: string; action?: IconName }) {
  return (
    <div className="shot-bar">
      <Icon name="chevron-left" size={13} />
      <span>{title}</span>
      {action && <Icon name={action} size={13} />}
    </div>
  );
}

const PLAN_STOPS: { name: string; nights: string; to: IconName | null }[] = [
  { name: 'Amsterdam', nights: '2 nachten', to: 'train' },
  { name: 'Berlijn', nights: '3 nachten', to: 'train' },
  { name: 'Praag', nights: '2 nachten', to: 'plane' },
  { name: 'Wenen', nights: '4 nachten', to: null },
];

/** The route planner: stops, nights, and how you get from one to the next. */
export function ShotPlanner() {
  return (
    <Phone>
      <ShotBar title="Interrail" action="plus" />
      <div className="shot-body shot-plan">
        {PLAN_STOPS.map((stop, i) => (
          <div className="shot-stop" key={stop.name} style={{ animationDelay: `${i * 0.11}s` }}>
            <span className="shot-stop-pin">{i + 1}</span>
            <span className="shot-stop-text">
              <strong>{stop.name}</strong>
              <small>{stop.nights}</small>
            </span>
            {stop.to && (
              <span className="shot-hop">
                <Icon name={stop.to} size={11} />
              </span>
            )}
          </div>
        ))}
        <div className="shot-total">
          <Icon name="distance" size={12} /> 1.842 km
        </div>
      </div>
    </Phone>
  );
}

/** The trip as you look back at it: days, photos, a note you typed. */
export function ShotTimeline() {
  return (
    <Phone>
      <ShotBar title="Praag" action="camera" />
      <div className="shot-body shot-timeline">
        <div className="shot-day">
          <span className="shot-day-num">4</span> Karelsbrug
        </div>
        <div className="shot-photos">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`shot-photo shot-photo-${i}`} />
          ))}
        </div>
        <p className="shot-note">Om zes uur op de brug. Helemaal leeg, alleen mist.</p>
        <div className="shot-day">
          <span className="shot-day-num">5</span> Naar Wenen
        </div>
        <div className="shot-photos shot-photos-wide">
          {[3, 4].map((i) => (
            <span key={i} className={`shot-photo shot-photo-${i}`} />
          ))}
        </div>
      </div>
    </Phone>
  );
}

/** A read-only link for people at home: map, photos, no account needed. */
export function ShotShare() {
  return (
    <Phone>
      <ShotBar title="Delen" />
      <div className="shot-body shot-share">
        <div className="shot-map">
          <svg viewBox="0 0 140 74" preserveAspectRatio="none">
            <path
              className="shot-map-route"
              d="M14 58 C 40 52, 46 26, 70 24 S 108 30, 126 16"
              fill="none"
            />
            <circle className="shot-map-pin" cx="14" cy="58" r="4" />
            <circle className="shot-map-pin" cx="70" cy="24" r="3.2" />
            <circle className="shot-map-pin shot-map-pin-end" cx="126" cy="16" r="4" />
          </svg>
        </div>
        <div className="shot-link">
          <Icon name="share" size={12} />
          <span>markmysteps/s/wenen-24</span>
        </div>
        <div className="shot-chips">
          <span>
            <Icon name="lock" size={10} /> Alleen lezen
          </span>
          <span>Geen account</span>
        </div>
      </div>
    </Phone>
  );
}

/** Tracking while it runs: a point now and then, buffered when there is no signal. */
export function ShotTracking() {
  return (
    <Phone>
      <ShotBar title="Onderweg" />
      <div className="shot-body shot-track">
        <div className="shot-live">
          <span className="shot-live-dot" />
          Route bijhouden
        </div>
        <div className="shot-rows">
          <span>
            Punten vandaag <strong>128</strong>
          </span>
          <span>
            Verbinding <strong className="shot-off">geen</strong>
          </span>
          <span>
            Gebufferd <strong>41</strong>
          </span>
          <span>
            Accu <strong className="shot-ok">zuinig</strong>
          </span>
        </div>
        <div className="shot-hint">
          <Icon name="cloud-off" size={12} /> Gaat vanzelf omhoog zodra je weer bereik hebt.
        </div>
      </div>
    </Phone>
  );
}
