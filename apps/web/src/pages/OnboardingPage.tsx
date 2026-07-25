import { registerPlugin } from '@capacitor/core';
import { ReactNode, TouchEvent as ReactTouchEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Trip } from '../api/types';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
import { Icon, IconName } from '../components/Icon';
import { Logo } from '../components/Logo';
import { isNativeApp, markOnboarded } from '../lib/native';
import { getThemeId, setThemeId, ThemeId } from '../lib/prefs';
import './onboarding.css';

// Example European trips for the globe demo (no navigation, no flights — clean
// ground routes so nothing weird crosses the globe).
const SAMPLE_TRIPS = [
  {
    id: 's-it',
    title: 'Italië',
    anchor: [11.5, 44],
    routePath: [
      [
        [12.5, 41.9], // Rome
        [11.25, 43.77], // Florence
        [11.34, 44.49], // Bologna
        [12.33, 45.44], // Venice
      ],
    ],
    distanceKm: 620,
    startDate: '2025-05-05',
    endDate: '2025-05-16',
    color: '#e0993a',
  },
  {
    id: 's-es',
    title: 'Spanje',
    anchor: [-2, 40],
    routePath: [
      [
        [2.17, 41.4], // Barcelona
        [-0.38, 39.47], // Valencia
        [-3.7, 40.4], // Madrid
        [-5.98, 37.39], // Sevilla
      ],
    ],
    distanceKm: 1100,
    startDate: '2024-09-01',
    endDate: '2024-09-14',
    color: '#4ca05c',
  },
  {
    id: 's-no',
    title: 'Noorwegen',
    anchor: [8, 60.5],
    routePath: [
      [
        [10.75, 59.91], // Oslo
        [7.99, 58.15], // Kristiansand
        [5.73, 58.97], // Stavanger
        [5.32, 60.39], // Bergen
      ],
    ],
    distanceKm: 900,
    startDate: '2025-07-10',
    endDate: '2025-07-22',
    color: '#5a6ee1',
  },
] as unknown as Trip[];

interface BgGeoPlugin {
  addWatcher(
    options: { requestPermissions?: boolean; stale?: boolean },
    callback: (position?: unknown, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BgGeoPlugin>('BackgroundGeolocation');

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
      const id = await BackgroundGeolocation.addWatcher(
        { requestPermissions: true, stale: true },
        (_position, error) => {
          setPermissionState(error?.code === 'NOT_AUTHORIZED' ? 'denied' : 'granted');
        },
      );
      window.setTimeout(() => void BackgroundGeolocation.removeWatcher({ id }), 4000);
    } catch {
      setPermissionState('denied');
    }
  }

  function finish() {
    markOnboarded();
    navigate('/', { replace: true });
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
      <Logo size={72} />
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
      <p className="muted">Kies je thema — je kunt dit later altijd wijzigen in Instellingen.</p>
      <div className="onb-theme-choice">
        {(['system', 'light', 'dark'] as ThemeId[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`onb-theme-opt ${theme === t ? 'active' : ''}`}
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
              <p className="error-text">Geweigerd — je kunt dit later aanzetten via Instellingen.</p>
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
            <button className="btn btn-ghost" onClick={() => void BackgroundGeolocation.openSettings()}>
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
    <main className="onb-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
