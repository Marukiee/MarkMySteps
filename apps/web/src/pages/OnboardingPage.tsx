import { registerPlugin } from '@capacitor/core';
import { ReactNode, TouchEvent as ReactTouchEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import { Logo } from '../components/Logo';
import { isNativeApp, markOnboarded } from '../lib/native';
import { getThemeId, setThemeId, ThemeId } from '../lib/prefs';
import './onboarding.css';

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
  const [touchX, setTouchX] = useState<number | null>(null);

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
        Jouw reizen, op jouw eigen server. Volg je route, plan je trip en deel ‘m — privé en zonder
        big tech.
      </p>
    </div>,
    feature(
      'compass',
      'Je reis op de globe',
      'Al je reizen als kleurrijke routes op een 3D-globe. Tik een reis om ‘m te openen en je tijdlijn met foto’s te bekijken.',
    ),
    feature(
      'pin',
      'Plan je route',
      'Bouw je route met stops, nachten en vervoer — auto, trein, boot of vlucht met tussenstops. Alles rekent automatisch mee.',
    ),
    feature(
      'share',
      'Deel met thuisblijvers',
      'Maak een privé, alleen-lezen link — foto’s en kaart, zonder dat iemand een account nodig heeft.',
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
              als je verplaatst — dat spaart je accu.
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
              <Icon name="lock" size={54} />
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
