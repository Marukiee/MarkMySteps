import { registerPlugin } from '@capacitor/core';
import {
  CSSProperties,
  Fragment,
  ReactNode,
  TouchEvent as ReactTouchEvent,
  useEffect,
  useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AirportPrefs } from '../components/AirportPrefs';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
import { Icon } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import {
  PlanItinerary,
  VisualAirports,
  VisualNotifs,
  VisualOffline,
  VisualShare,
  VisualStart,
  VisualTheme,
  VisualTrips,
} from '../components/OnboardingShots';
import { t } from '../i18n';
import { tr } from '../i18n/rich';
import {
  GalleryPermissions,
  galleryPermissions,
  requestGalleryPermission,
} from '../lib/gallery';
import { getLocalName, isLocalMode, setLocalName } from '../lib/localMode';
import { alwaysLabel, isIosApp, isNativeApp, markOnboarded } from '../lib/native';
import { getThemeId, setThemeId, ThemeId } from '../lib/prefs';
import { PLAN_ROUTE, PLAN_TRIP, SAMPLE_TRIPS } from './onboardingSamples';
import './onboarding.css';
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

/**
 * A path through settings, "Instellingen › Voorkeuren", with the app's own
 * chevron between the steps. The steps come from the dictionary as one line,
 * so the whole path is translated in one piece.
 */
function pathSteps(text: string): string[] {
  return text.split(' › ');
}

/**
 * Onboarding, second attempt.
 *
 * The tour it replaces is the shape this one keeps: a medallion, a heading, a
 * line of copy, dots and a button. What changes is that the medallion does
 * something, and what it does is drawn from the app — the map's numbered pins
 * arriving in travel order, the photo grid of a day filling in, a plane taking
 * the bow the globe draws. An icon in a rounded square named the feature; this
 * shows the shape you will meet a minute later.
 *
 * Reachable from developer options only, until it replaces the real one.
 */
export function OnboardingV2Page() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  // Being able to look at it is the point for now: a preview never marks the
  // tour as done and never keeps the name typed on it.
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
    }, 300);
  }

  /** A slide that only tells you something: a moving medallion and the words. */
  const feature = (key: string, visual: ReactNode, title: string, body: string): ReactNode => (
    <div className="onb-feature" key={key}>
      {visual}
      <h1>{title}</h1>
      <p className="muted">{body}</p>
    </div>
  );

  /** Ask ⇄ granted, as the first tour has it. */
  const permission = (
    granted: boolean,
    label: string,
    okLabel: string,
    onAsk: () => void,
    disabled = false,
  ): ReactNode => (
    <div className={`onb-perm ${granted ? 'granted' : ''}`}>
      <button className="btn btn-primary onb-ask" disabled={disabled} onClick={onAsk}>
        {label}
      </button>
      <p className="onb-ok">
        <Icon name="check" size={18} /> {okLabel}
      </p>
    </div>
  );

  const slides: ReactNode[] = [
    <div className="onb-feature onb-welcome" key="welcome">
      <span className="onb2-mark">
        <LogoMark size={78} />
      </span>
      <h1>{t('onboarding.welcome.title')}</h1>
      <p className="muted">{t('onboarding.welcome.body')}</p>
    </div>,
    ...(localOnly
      ? [
          <div className="onb-feature" key="name">
            <span className="onb-visual">
              <Icon name="person" size={54} />
            </span>
            <h1>{t('onboarding.name.title')}</h1>
            <p className="muted">{t('onboarding.name.body')}</p>
            <div className="field onb-name">
              <input
                autoComplete="name"
                placeholder={t('onboarding.name.placeholder')}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!previewLocal && !preview) setLocalName(e.target.value);
                }}
              />
            </div>
          </div>,
        ]
      : []),
    <div className="onb-feature onb-globe-slide" key="globe">
      <div className="onb-globe" aria-hidden="true">
        <GlobeBackdrop trips={SAMPLE_TRIPS} noTour />
      </div>
      <h1>{t('onboarding.globe.title')}</h1>
      <p className="muted">{t('onboarding.globe.body')}</p>
    </div>,
    // The route builds itself on the same globe the app uses, with the
    // itinerary writing itself underneath in the planner's own shape — and a
    // stop being dragged into a different place in it, because that is the
    // other half of planning.
    <div className="onb-feature onb-globe-slide onb-plan-slide" key="plan">
      <div className="onb-globe onb-globe-sm" aria-hidden="true">
        <GlobeBackdrop trips={PLAN_TRIP} solo />
      </div>
      <PlanItinerary stops={PLAN_ROUTE} />
      <h1>{t('onboarding.plan.title')}</h1>
      <p className="muted">{t('onboarding.plan.body')}</p>
    </div>,
    feature(
      'trips',
      <VisualTrips />,
      t('onboarding.trips.title'),
      t('onboarding.trips.body'),
    ),
    // Nothing to share without a server to share it from.
    ...(localOnly
      ? []
      : [
          feature(
            'share',
            <VisualShare />,
            t('onboarding.share.title'),
            t('onboarding.share.body'),
          ),
        ]),
    feature(
      'offline',
      <VisualOffline />,
      t('onboarding.offline.title'),
      t('onboarding.offline.body'),
    ),
    <div className="onb-feature" key="theme">
      <VisualTheme />
      <h1>{t('onboarding.theme.title')}</h1>
      <p className="muted">{t('onboarding.theme.body')}</p>
      <div
        className="theme-choice onb-theme-choice pill-switch"
        style={
          { '--n': 3, '--i': ['system', 'light', 'dark'].indexOf(theme) } as CSSProperties
        }
      >
        {(['system', 'light', 'dark'] as ThemeId[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`theme-opt ${theme === id ? 'active' : ''}`}
            onClick={() => {
              setTheme(id);
              setThemeId(id);
            }}
          >
            {id === 'system'
              ? t('common.automatic')
              : id === 'light'
                ? t('onboarding.theme.light')
                : t('onboarding.theme.dark')}
          </button>
        ))}
      </div>
    </div>,
    <div className="onb-feature onb-airports-slide" key="airports">
      <VisualAirports />
      <h1>{t('onboarding.airports.title')}</h1>
      <p className="muted">
        {tr('onboarding.airports.body', {
          path: (s) => (
            <strong className="onb-inline-path">
              {pathSteps(String(s)).map((step, i) => (
                <Fragment key={i}>
                  {i > 0 && (
                    <>
                      {' '}
                      <Icon name="chevron-right" size={13} />{' '}
                    </>
                  )}
                  {step}
                </Fragment>
              ))}
            </strong>
          ),
        })}
      </p>
      <AirportPrefs />
    </div>,
    ...(isApp
      ? [
          <div className="onb-feature" key="location">
            <span className="onb-visual">
              <Icon name="pin" size={54} />
            </span>
            <h1>{t('onboarding.location.title')}</h1>
            <p className="muted">{t('onboarding.location.body')}</p>
            {permission(perms.location, t('onboarding.perm.ask'), t('onboarding.perm.granted'), () =>
              void ask('location'),
            )}
            {denied.location && !perms.location && (
              <p className="error-text">{t('onboarding.perm.denied')}</p>
            )}
          </div>,
          <div className="onb-feature" key="always">
            <span className="onb-visual">
              <Icon name="pin" size={54} />
            </span>
            <h1>{t('onboarding.always.title')}</h1>
            <p className="muted">{t('onboarding.always.body', { always: alwaysLabel() })}</p>
            <div className="onb-path">
              {pathSteps(t(isIosApp() ? 'onboarding.always.pathIos' : 'onboarding.always.path')).map((p, i) => (
                <span key={p} className="onb-path-step">
                  {i > 0 && <Icon name="chevron-right" size={13} />}
                  <span>{p}</span>
                </span>
              ))}
            </div>
            {permission(
              perms.background,
              t('onboarding.always.ask'),
              t('onboarding.always.granted'),
              () => void ask('background'),
              !perms.location,
            )}
            {!perms.background && (
              <button className="btn btn-ghost" onClick={() => void MmsLocation.openSettings()}>
                {t('onboarding.always.openSettings')}
              </button>
            )}
          </div>,
          ...(localOnly
            ? [
                <div className="onb-feature" key="gallery">
                  <span className="onb-visual">
                    <Icon name="camera" size={54} />
                  </span>
                  <h1>{t('onboarding.gallery.title')}</h1>
                  <p className="muted">{t('onboarding.gallery.body')}</p>
                  {permission(
                    gallery.library,
                    t('onboarding.gallery.ask'),
                    t('onboarding.gallery.granted'),
                    () => void askGallery(),
                  )}
                  {gallery.library && !gallery.location && (
                    <p className="error-text">{t('onboarding.gallery.noLocation')}</p>
                  )}
                  {galleryAsked && !gallery.library && (
                    <p className="error-text">{t('onboarding.perm.denied')}</p>
                  )}
                </div>,
              ]
            : []),
          <div className="onb-feature" key="notifs">
            <VisualNotifs />
            <h1>{t('onboarding.notifs.title')}</h1>
            <p className="muted">{t('onboarding.notifs.body')}</p>
            {permission(perms.notifications, t('onboarding.notifs.ask'), t('onboarding.notifs.granted'), () =>
              void ask('notifications'),
            )}
            {denied.notifications && !perms.notifications && (
              <p className="error-text">{t('onboarding.notifs.denied')}</p>
            )}
          </div>,
        ]
      : []),
    // The tour ended on whatever permission happened to come last, which read
    // as "and now what". This says what the next tap is for.
    feature(
      'start',
      <VisualStart />,
      t('onboarding.start.title'),
      t('onboarding.start.body'),
    ),
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
          {t('onboarding.skip')}
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
          {last ? t('onboarding.finish') : t('common.next')}
        </button>
      </div>
    </main>
  );
}
