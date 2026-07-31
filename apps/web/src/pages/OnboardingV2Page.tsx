import { registerPlugin } from '@capacitor/core';
import { ReactNode, TouchEvent as ReactTouchEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AirportPrefs } from '../components/AirportPrefs';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
import { Icon } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import {
  Phone,
  ShotPlanner,
  ShotShare,
  ShotTimeline,
  ShotTracking,
} from '../components/OnboardingShots';
import {
  GalleryPermissions,
  galleryPermissions,
  requestGalleryPermission,
} from '../lib/gallery';
import { getLocalName, isLocalMode, setLocalName } from '../lib/localMode';
import { isNativeApp, markOnboarded } from '../lib/native';
import { getThemeId, setThemeId, ThemeId } from '../lib/prefs';
import { SAMPLE_TRIPS } from './onboardingSamples';
import './onboarding2.css';

/** Our own AOSP location plugin (see MmsLocationPlugin.java). */
interface PermissionStatus {
  location: boolean;
  background: boolean;
  notifications: boolean;
}

interface MmsLocationPlugin {
  requestPermission(options: {
    type: 'location' | 'background' | 'notifications';
  }): Promise<PermissionStatus>;
  permissionStatus(): Promise<PermissionStatus>;
  openSettings(): Promise<void>;
}

const MmsLocation = registerPlugin<MmsLocationPlugin>('MmsLocation');

/** A slide: what it shows, what it says, and anything you can do on it. */
interface Slide {
  key: string;
  /** The picture half. A mock screen, the globe, or the logo. */
  visual: ReactNode;
  eyebrow?: string;
  title: string;
  body: ReactNode;
  /** Anything to type, choose or grant. Sits under the copy. */
  action?: ReactNode;
}

/**
 * Onboarding, second attempt.
 *
 * The first one explained the app with an icon in a rounded square per slide,
 * which said what the feature was called and nothing about what it looks like.
 * This one shows the screen you are being told about — miniature, live, built
 * from the app's own tokens (see OnboardingShots) rather than screenshots that
 * would be wrong in the other theme and stale by the next release.
 *
 * Reachable from developer options only, until it replaces the real one.
 */
export function OnboardingV2Page() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  // Being able to look at it is the whole point for now: a preview never marks
  // the tour as done and never keeps the name that gets typed on it.
  const preview = params.get('preview') === '1';
  const previewLocal = params.get('local') === '1';
  const isApp = isNativeApp();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [theme, setTheme] = useState<ThemeId>(getThemeId());
  const [touchX, setTouchX] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [perms, setPerms] = useState<PermissionStatus>({
    location: false,
    background: false,
    notifications: false,
  });
  const [denied, setDenied] = useState<Partial<Record<keyof PermissionStatus, boolean>>>({});
  const localOnly = previewLocal || (isApp && isLocalMode());
  const [gallery, setGallery] = useState<GalleryPermissions>({ library: false, location: false });
  const [galleryAsked, setGalleryAsked] = useState(false);
  const [name, setName] = useState(getLocalName());

  useEffect(() => {
    if (!isApp) return;
    void MmsLocation.permissionStatus().then(setPerms).catch(() => undefined);
  }, [isApp]);

  useEffect(() => {
    if (!localOnly) return;
    void galleryPermissions().then(setGallery).catch(() => undefined);
  }, [localOnly]);

  async function askGallery() {
    setGallery(await requestGalleryPermission());
    setGalleryAsked(true);
  }

  async function ask(type: keyof PermissionStatus) {
    try {
      const status = await MmsLocation.requestPermission({ type });
      setPerms(status);
      setDenied((d) => ({ ...d, [type]: !status[type] }));
    } catch {
      setDenied((d) => ({ ...d, [type]: true }));
    }
  }

  function finish() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      if (preview) {
        navigate('/settings', { replace: true });
        return;
      }
      markOnboarded();
      void refresh();
      navigate('/', { replace: true });
    }, 320);
  }

  /** Ask ⇄ granted, the same crossfade the first tour used. */
  const permission = (
    granted: boolean,
    label: string,
    okLabel: string,
    onAsk: () => void,
    disabled = false,
  ): ReactNode => (
    <div className={`onb2-perm ${granted ? 'granted' : ''}`}>
      <button className="btn btn-primary onb2-ask" disabled={disabled} onClick={onAsk}>
        {label}
      </button>
      <p className="onb2-ok">
        <Icon name="check" size={18} /> {okLabel}
      </p>
    </div>
  );

  const slides: Slide[] = [
    {
      key: 'welcome',
      visual: (
        <div className="onb2-hero">
          <LogoMark size={96} />
        </div>
      ),
      eyebrow: 'Welkom',
      title: 'MarkMySteps',
      body: (
        <>
          Je route, je stops en je foto&apos;s op één plek. Op je eigen server, dus alles blijft van
          jou.
        </>
      ),
    },
    ...(localOnly
      ? [
          {
            key: 'name',
            visual: (
              <Phone>
                <div className="onb2-namecard">
                  <Icon name="person" size={30} />
                  <span className="onb2-namecard-line" />
                  <span className="onb2-namecard-line short" />
                </div>
              </Phone>
            ),
            eyebrow: 'Zonder server',
            title: 'Hoe heet je?',
            body: 'Geen account, geen wachtwoord. Je naam staat alleen op je eigen reizen en blijft op dit toestel.',
            action: (
              <div className="field onb2-name">
                <input
                  autoComplete="name"
                  placeholder="Je naam"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!previewLocal && !preview) setLocalName(e.target.value);
                  }}
                />
              </div>
            ),
          } satisfies Slide,
        ]
      : []),
    {
      key: 'globe',
      visual: (
        <div className="onb2-globe" aria-hidden="true">
          <GlobeBackdrop trips={SAMPLE_TRIPS} noTour />
        </div>
      ),
      eyebrow: 'Je startscherm',
      title: 'Al je reizen op één globe',
      body: 'Elke reis een eigen kleur, elke stop een bolletje. Tik een reis aan en de globe draait ernaartoe en speelt de route af.',
    },
    {
      key: 'plan',
      visual: <ShotPlanner />,
      eyebrow: 'Vooraf',
      title: 'Plan je route',
      body: 'Stops, nachten en vervoer: auto, trein, boot of een vlucht met tussenstops. De kilometers rekenen zichzelf uit.',
    },
    {
      key: 'timeline',
      visual: <ShotTimeline />,
      eyebrow: 'Onderweg en erna',
      title: 'Je dagen terugkijken',
      body: 'Foto’s uit je eigen Immich komen vanzelf op de juiste dag en de juiste plek te staan. Een notitie erbij en de dag is af.',
    },
    {
      key: 'share',
      visual: <ShotShare />,
      eyebrow: 'Thuisfront',
      title: 'Deel zonder account',
      body: 'Eén privélink met je kaart, je dagen en je foto’s. Alleen lezen, en zo weer ingetrokken.',
    },
    {
      key: 'tracking',
      visual: <ShotTracking />,
      eyebrow: 'Automatisch',
      title: 'Zuinig en offline',
      body: 'De app bewaart alleen een punt als je echt beweegt. Geen bereik? Dan wacht alles op je toestel tot je weer online bent.',
    },
    {
      key: 'theme',
      visual: (
        <div className="onb2-themes" aria-hidden="true">
          <span className="onb2-theme-swatch light" />
          <span className="onb2-theme-swatch dark" />
        </div>
      ),
      eyebrow: 'Weergave',
      title: 'Licht of donker?',
      body: 'Kies wat je fijn vindt. Later aanpassen kan altijd in Instellingen.',
      action: (
        <div className="theme-choice onb2-theme-choice">
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
      ),
    },
    {
      key: 'airports',
      visual: (
        <Phone>
          <div className="onb2-airportcard">
            <Icon name="plane" size={26} />
            <span>AMS</span>
            <span>EIN</span>
            <span>RTM</span>
          </div>
        </Phone>
      ),
      eyebrow: 'Voorkeuren',
      title: 'Je vaste vliegvelden',
      body: (
        <>
          Het eerste vliegveld wordt vast ingevuld bij een nieuwe vlucht. Later aanpasbaar via{' '}
          <strong className="onb2-inline-path">
            Instellingen <Icon name="chevron-right" size={13} /> Voorkeuren
          </strong>
          .
        </>
      ),
      action: <AirportPrefs />,
    },
    ...(isApp
      ? [
          {
            key: 'location',
            visual: (
              <div className="onb2-hero onb2-hero-icon">
                <Icon name="pin" size={54} />
              </div>
            ),
            eyebrow: 'Toestemming',
            title: 'Locatie',
            body: 'Voor het bijhouden van je route. Er wordt alleen een GPS-punt bewaard als je verplaatst, dat spaart je accu.',
            action: (
              <>
                {permission(perms.location, 'Toestemming vragen', 'Toestemming gegeven', () =>
                  void ask('location'),
                )}
                {denied.location && !perms.location && (
                  <p className="error-text">
                    Geweigerd. Je kunt dit later aanzetten via Instellingen.
                  </p>
                )}
              </>
            ),
          } satisfies Slide,
          {
            key: 'always',
            visual: (
              <div className="onb2-hero onb2-hero-icon">
                <Icon name="shield" size={54} />
              </div>
            ),
            eyebrow: 'Toestemming',
            title: '“Altijd toestaan”',
            body: 'Met het scherm uit doortracken kan alleen op “Altijd toestaan”. Stuurt Android je door, volg dan dit pad:',
            action: (
              <>
                <div className="onb2-path">
                  {['Apps', 'MarkMySteps', 'Rechten', 'Locatie', 'Altijd toestaan'].map((p, i) => (
                    <span key={p} className="onb2-path-step">
                      {i > 0 && <Icon name="chevron-right" size={13} />}
                      <span>{p}</span>
                    </span>
                  ))}
                </div>
                {permission(
                  perms.background,
                  'Altijd toestaan vragen',
                  'Altijd toegestaan',
                  () => void ask('background'),
                  !perms.location,
                )}
                {!perms.background && (
                  <button className="btn btn-ghost" onClick={() => void MmsLocation.openSettings()}>
                    Open systeeminstellingen
                  </button>
                )}
              </>
            ),
          } satisfies Slide,
          ...(localOnly
            ? [
                {
                  key: 'gallery',
                  visual: (
                    <div className="onb2-hero onb2-hero-icon">
                      <Icon name="camera" size={54} />
                    </div>
                  ),
                  eyebrow: 'Toestemming',
                  title: "Je foto's",
                  body: "Zonder server komen je foto's uit de galerij van dit toestel. Ze blijven waar ze staan; de app leest ze alleen. De locatie in een foto vraagt Android apart, en zonder die tweede vraag komen ze niet op de kaart.",
                  action: (
                    <>
                      {permission(gallery.library, "Toegang tot foto's", 'Toegang gegeven', () =>
                        void askGallery(),
                      )}
                      {gallery.library && !gallery.location && (
                        <p className="error-text">
                          Locatie in foto&apos;s geweigerd. Ze komen dan niet op de kaart.
                        </p>
                      )}
                      {galleryAsked && !gallery.library && (
                        <p className="error-text">
                          Geweigerd. Je kunt dit later aanzetten via Instellingen.
                        </p>
                      )}
                    </>
                  ),
                } satisfies Slide,
              ]
            : []),
          {
            key: 'notifs',
            visual: (
              <div className="onb2-hero onb2-hero-icon">
                <Icon name="bell" size={54} />
              </div>
            ),
            eyebrow: 'Toestemming',
            title: 'Meldingen',
            body: 'Voor de tracking-status en updates van reisgenoten. Altijd aan te passen in de toestelinstellingen.',
            action: (
              <>
                {permission(perms.notifications, 'Meldingen toestaan', 'Ingesteld', () =>
                  void ask('notifications'),
                )}
                {denied.notifications && !perms.notifications && (
                  <p className="error-text">
                    Geweigerd. Zonder melding kan de tracking niet op de achtergrond draaien.
                  </p>
                )}
              </>
            ),
          } satisfies Slide,
        ]
      : []),
  ];

  const current = slides[Math.min(step, slides.length - 1)]!;
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
      className={`onb2-shell ${leaving ? 'onb2-leaving' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* A wash behind the mock, so the screen being shown sits in something
          rather than floating on a flat page. */}
      <div className="onb2-wash" aria-hidden="true" />

      <div className="onb2-top">
        <div className="onb2-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${(step + 1) / slides.length})` }} />
        </div>
        {!last && (
          <button className="onb2-skip" onClick={finish}>
            Overslaan
          </button>
        )}
      </div>

      <div className="onb2-stage" key={current.key} data-dir={dir}>
        <div className="onb2-visual">{current.visual}</div>
        <div className="onb2-copy">
          {current.eyebrow && <span className="onb2-eyebrow">{current.eyebrow}</span>}
          <h1>{current.title}</h1>
          <p className="muted">{current.body}</p>
          {current.action && <div className="onb2-action">{current.action}</div>}
        </div>
      </div>

      <div className="onb2-footer">
        <button
          className="btn btn-ghost onb2-back"
          disabled={step === 0}
          onClick={() => go(step - 1)}
        >
          <Icon name="chevron-left" size={16} /> Terug
        </button>
        <button className="btn btn-primary onb2-next" onClick={() => (last ? finish() : go(step + 1))}>
          {last ? 'Aan de slag' : 'Volgende'}
          {!last && <Icon name="chevron-right" size={16} />}
        </button>
      </div>
    </main>
  );
}
