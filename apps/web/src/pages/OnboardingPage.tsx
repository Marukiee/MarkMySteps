import { registerPlugin } from '@capacitor/core';
import { ReactNode, TouchEvent as ReactTouchEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Trip } from '../api/types';
import { AirportPrefs } from '../components/AirportPrefs';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
import { Icon, IconName } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import { isNativeApp, markOnboarded } from '../lib/native';
import { getThemeId, setThemeId, ThemeId } from '../lib/prefs';
import './onboarding.css';

// Example European trips for the globe demo. A few realistic multi-city routes
// plus a city trip and one flight, so the onboarding globe shows exactly what a
// filled-in account looks like (dots at the real start/end, a flight bow).
// Home airport used for the demo outbound/return flight bows.
const AMS: [number, number] = [4.9, 52.37];
const SAMPLE_TRIPS = [
  {
    id: 's-scan',
    title: 'Scandinavië',
    anchor: [11.97, 57.71],
    routePath: [
      [
        [11.97, 57.71], // Gothenburg
        [10.75, 59.91], // Oslo
        [10.4, 63.43], // Trondheim
        [14.4, 67.28], // Bodø (keeps each hop short so no leg reads as a flight)
        [18.96, 69.65], // Tromsø
      ],
    ],
    // Fly out to the start, fly home from the end — no flight mid-route.
    flightPath: [
      [AMS, [11.97, 57.71]],
      [[18.96, 69.65], AMS],
    ],
    distanceKm: 1900,
    startDate: '2025-06-04',
    endDate: '2025-06-18',
    color: '#5a6ee1',
  },
  {
    id: 's-es',
    title: 'Spanje',
    anchor: [2.17, 41.4],
    routePath: [
      [
        [2.17, 41.4], // Barcelona
        [-3.7, 40.4], // Madrid
        [-4.42, 36.72], // Málaga
      ],
    ],
    flightPath: [
      [AMS, [2.17, 41.4]],
      [[-4.42, 36.72], AMS],
    ],
    distanceKm: 1000,
    startDate: '2024-09-01',
    endDate: '2024-09-12',
    color: '#e0993a',
  },
  {
    id: 's-balkan',
    title: 'Balkan',
    anchor: [23.73, 37.98],
    routePath: [
      [
        [23.73, 37.98], // Athens
        [22.94, 40.64], // Thessaloniki
        [23.32, 42.7], // Sofia
      ],
    ],
    flightPath: [
      [AMS, [23.73, 37.98]],
      [[23.32, 42.7], AMS],
    ],
    distanceKm: 750,
    startDate: '2025-04-10',
    endDate: '2025-04-20',
    color: '#4ca05c',
  },
  {
    id: 's-krk',
    title: 'Krakau',
    anchor: [19.94, 50.06],
    routePath: null,
    // City trip: just there and back from home.
    flightPath: [[AMS, [19.94, 50.06]]],
    distanceKm: 0,
    startDate: '2024-11-15',
    endDate: '2024-11-18',
    color: '#c65d8a',
  },
] as unknown as Trip[];

/** Our own AOSP location plugin (see MmsLocationPlugin.java). */
interface MmsLocationPlugin {
  start(options: { startService: false }): Promise<{ granted: boolean; background: boolean }>;
  openSettings(): Promise<void>;
}

const MmsLocation = registerPlugin<MmsLocationPlugin>('MmsLocation');

/** First-run flow: a swipeable tour of what the app does, then permissions. */
export function OnboardingPage() {
  const navigate = useNavigate();
  const isApp = isNativeApp();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [permissionState, setPermissionState] = useState<'idle' | 'granted' | 'denied'>('idle');
  const [theme, setTheme] = useState<ThemeId>(getThemeId());
  const [notifDone, setNotifDone] = useState(false);
  const [touchX, setTouchX] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);

  async function requestNotifications() {
    try {
      if ('Notification' in window) await Notification.requestPermission();
    } catch {
      /* best effort — Android also asks when tracking starts */
    }
    setNotifDone(true);
  }

  async function requestLocation() {
    try {
      // Runs the permission chain (fine → background → notifications) without
      // switching tracking on.
      const { granted } = await MmsLocation.start({ startService: false });
      setPermissionState(granted ? 'granted' : 'denied');
    } catch {
      setPermissionState('denied');
    }
  }

  function finish() {
    if (leaving) return;
    // Fade the whole tour out before leaving, instead of snapping to the app.
    setLeaving(true);
    window.setTimeout(() => {
      markOnboarded();
      navigate('/', { replace: true });
    }, 300);
  }

  const feature = (icon: IconName, title: string, body: string): ReactNode => (
    <div className="onb-feature">
      <span className="onb-visual">
        <Icon name={icon} size={54} />
      </span>
      <h1>{title}</h1>
      <p className="muted">{body}</p>
    </div>
  );

  const slides: ReactNode[] = [
    <div className="onb-feature onb-welcome" key="welcome">
      <LogoMark size={78} />
      <h1>Welkom bij MarkMySteps</h1>
      <p className="muted">
        Jouw reizen, op jouw eigen server. Volg je route, plan je trip en deel ‘m. Privé en zonder
        big tech.
      </p>
    </div>,
    <div className="onb-feature onb-globe-slide" key="globe">
      <div className="onb-globe" aria-hidden="true">
        <GlobeBackdrop trips={SAMPLE_TRIPS} noTour />
      </div>
      <h1>Je reizen in kaart</h1>
      <p className="muted">
        Al je reizen als kleurrijke routes op een 3D-globe. Tik een reis om ‘m te openen met je
        tijdlijn en foto’s.
      </p>
    </div>,
    feature(
      'pin',
      'Plan je route',
      'Bouw je route met stops, nachten en vervoer: auto, trein, boot of vlucht met tussenstops. Alles rekent automatisch mee.',
    ),
    feature(
      'share',
      'Deel met thuisblijvers',
      'Maak een privé, alleen-lezen link met foto’s en kaart, zonder dat iemand een account nodig heeft.',
    ),
    feature(
      'lock',
      'Zuinig & offline',
      'Tracking is zuinig met je accu en werkt zonder internet: alles wordt gebufferd en later geüpload.',
    ),
    <div className="onb-feature" key="theme">
      <span className="onb-visual">
        <Icon name="gear" size={54} />
      </span>
      <h1>Licht of donker?</h1>
      <p className="muted">Kies je thema. Je kunt dit later altijd wijzigen in Instellingen.</p>
      {/* Same pill toggle + animation as Instellingen → Weergave. */}
      <div className="theme-choice onb-theme-choice">
        {(['system', 'light', 'dark'] as ThemeId[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`theme-opt ${theme === t ? 'active' : ''}`}
            onClick={() => {
              setTheme(t);
              setThemeId(t);
            }}
          >
            {t === 'system' ? 'Automatisch' : t === 'light' ? 'Licht' : 'Donker'}
          </button>
        ))}
      </div>
    </div>,
    <div className="onb-feature onb-airports-slide" key="airports">
      <span className="onb-visual">
        <Icon name="plane" size={54} />
      </span>
      <h1>Je vaste vliegvelden</h1>
      <p className="muted">
        Vanaf welke vliegvelden vertrek je meestal? Schiphol staat al klaar; voeg toe wat je wilt.
        Het eerste wordt automatisch ingevuld bij een nieuwe vlucht. Later aanpasbaar via{' '}
        <strong className="onb-inline-path">
          Instellingen <Icon name="chevron-right" size={13} /> Voorkeuren
        </strong>
        .
      </p>
      <AirportPrefs />
    </div>,
    ...(isApp
      ? [
          <div className="onb-feature" key="location">
            <span className="onb-visual">
              <Icon name="pin" size={54} />
            </span>
            <h1>Locatietoestemming</h1>
            <p className="muted">
              Voor route-tracking vraagt de app om je locatie. Er wordt alléén een GPS-punt bewaard
              als je verplaatst, dat spaart je accu.
            </p>
            <div className={`onb-perm ${permissionState === 'granted' ? 'granted' : ''}`}>
              <button className="btn btn-primary onb-ask" onClick={() => void requestLocation()}>
                Toestemming vragen
              </button>
              <p className="onb-ok">
                <Icon name="check" size={18} /> Toestemming gegeven
              </p>
            </div>
            {permissionState === 'denied' && (
              <p className="error-text">Geweigerd. Je kunt dit later aanzetten via Instellingen.</p>
            )}
          </div>,
          <div className="onb-feature" key="always">
            <span className="onb-visual">
              <Icon name="shield" size={54} />
            </span>
            <h1>“Altijd toestaan”</h1>
            <p className="muted">
              Tracking met het scherm uit kan alleen als locatie op “Altijd toestaan” staat:
            </p>
            <div className="onb-path">
              {['Apps', 'MarkMySteps', 'Rechten', 'Locatie', 'Altijd toestaan'].map((p, i) => (
                <span key={p} className="onb-path-step">
                  {i > 0 && <Icon name="chevron-right" size={13} />}
                  <span>{p}</span>
                </span>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={() => void MmsLocation.openSettings()}>
              Open systeeminstellingen
            </button>
          </div>,
          <div className="onb-feature" key="notifs">
            <span className="onb-visual">
              <Icon name="bell" size={54} />
            </span>
            <h1>Meldingen</h1>
            <p className="muted">
              Voor de tracking-status en updates van reisgenoten. Je kunt dit altijd aanpassen in de
              toestelinstellingen.
            </p>
            <div className={`onb-perm ${notifDone ? 'granted' : ''}`}>
              <button className="btn btn-primary onb-ask" onClick={() => void requestNotifications()}>
                Meldingen toestaan
              </button>
              <p className="onb-ok">
                <Icon name="check" size={18} /> Ingesteld
              </p>
            </div>
          </div>,
        ]
      : []),
  ];

  const last = step === slides.length - 1;
  const go = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(Math.max(0, Math.min(slides.length - 1, next)));
  };

  const onTouchStart = (e: ReactTouchEvent) => setTouchX(e.touches[0]!.clientX);
  const onTouchEnd = (e: ReactTouchEvent) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0]!.clientX - touchX;
    setTouchX(null);
    if (dx < -50) last ? finish() : go(step + 1);
    else if (dx > 50 && step > 0) go(step - 1);
  };

  return (
    <main
      className={`onb-shell ${leaving ? 'onb-leaving' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {!last && (
        <button className="onb-skip" onClick={finish}>
          Overslaan
        </button>
      )}

      <div className="onb-stage" key={step} data-dir={dir}>
        {slides[step]}
      </div>

      <div className="onb-footer">
        <div className="onb-dots">
          {slides.map((_, i) => (
            <span key={i} className={`onb-dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>
        <button className="btn btn-primary onb-next" onClick={() => (last ? finish() : go(step + 1))}>
          {last ? 'Aan de slag' : 'Volgende'}
        </button>
      </div>
    </main>
  );
}
