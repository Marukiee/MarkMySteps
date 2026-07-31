import { registerPlugin } from '@capacitor/core';
import { ReactNode, TouchEvent as ReactTouchEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AirportPrefs } from '../components/AirportPrefs';
import { GlobeBackdrop } from '../components/GlobeBackdrop';
import { Icon } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import {
  VisualAirports,
  VisualDays,
  VisualOffline,
  VisualRoute,
  VisualShare,
  VisualTheme,
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
      <h1>Welkom bij MarkMySteps</h1>
      <p className="muted">
        Volg je route, plan je reis en kijk 'm later terug. Alles blijft van jou.
      </p>
    </div>,
    ...(localOnly
      ? [
          <div className="onb-feature" key="name">
            <span className="onb-visual">
              <Icon name="person" size={54} />
            </span>
            <h1>Hoe heet je?</h1>
            <p className="muted">
              Zonder server is er geen account en geen wachtwoord. Je naam staat alleen op je eigen
              reizen, en blijft op dit toestel.
            </p>
            <div className="field onb-name">
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
          </div>,
        ]
      : []),
    <div className="onb-feature onb-globe-slide" key="globe">
      <div className="onb-globe" aria-hidden="true">
        <GlobeBackdrop trips={SAMPLE_TRIPS} noTour />
      </div>
      <h1>Je reizen in kaart</h1>
      <p className="muted">
        Al je reizen als kleurrijke routes op een 3D-globe, met een bolletje voor elke stop. Tik een
        reis om ‘m te openen met je tijdlijn en foto’s.
      </p>
    </div>,
    feature(
      'plan',
      <VisualRoute />,
      'Plan je route',
      'Bouw je route met stops, nachten en vervoer: auto, trein, boot of vlucht met tussenstops. Alles rekent automatisch mee.',
    ),
    feature(
      'days',
      <VisualDays />,
      'Je dagen terugkijken',
      'Je foto’s komen vanzelf op de juiste dag en de juiste plek te staan. Een notitie erbij en de dag is af.',
    ),
    feature(
      'share',
      <VisualShare />,
      'Deel met thuisblijvers',
      'Eén privélink met je kaart, je dagen en je foto’s. Alleen lezen, en niemand hoeft een account te maken.',
    ),
    feature(
      'offline',
      <VisualOffline />,
      'Zuinig & offline',
      'Tracking is zuinig met je accu en werkt zonder internet: alles wordt gebufferd en later geüpload.',
    ),
    <div className="onb-feature" key="theme">
      <VisualTheme />
      <h1>Licht of donker?</h1>
      <p className="muted">Kies je thema. Je kunt dit later altijd wijzigen in Instellingen.</p>
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
      <VisualAirports />
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
            {permission(perms.location, 'Toestemming vragen', 'Toestemming gegeven', () =>
              void ask('location'),
            )}
            {denied.location && !perms.location && (
              <p className="error-text">Geweigerd. Je kunt dit later aanzetten via Instellingen.</p>
            )}
          </div>,
          <div className="onb-feature" key="always">
            <span className="onb-visual">
              <Icon name="shield" size={54} />
            </span>
            <h1>“Altijd toestaan”</h1>
            <p className="muted">
              Tracking met het scherm uit kan alleen als locatie op “Altijd toestaan” staat. Vraag
              het hier aan; stuurt Android je door naar de instellingen, volg dan dit pad:
            </p>
            <div className="onb-path">
              {['Apps', 'MarkMySteps', 'Rechten', 'Locatie', 'Altijd toestaan'].map((p, i) => (
                <span key={p} className="onb-path-step">
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
          </div>,
          ...(localOnly
            ? [
                <div className="onb-feature" key="gallery">
                  <span className="onb-visual">
                    <Icon name="camera" size={54} />
                  </span>
                  <h1>Je foto's</h1>
                  <p className="muted">
                    Zonder server komen je foto's uit de galerij van je toestel. Ze blijven waar ze
                    staan: de app leest ze alleen, en er gaat niets naar buiten. Android geeft de
                    locatie in een foto pas vrij met een aparte toestemming; zonder die tweede vraag
                    komen ze niet op de kaart.
                  </p>
                  {permission(gallery.library, "Toegang tot foto's", 'Toegang gegeven', () =>
                    void askGallery(),
                  )}
                  {gallery.library && !gallery.location && (
                    <p className="error-text">
                      Locatie in foto&apos;s geweigerd. Ze komen dan niet op de kaart te staan.
                    </p>
                  )}
                  {galleryAsked && !gallery.library && (
                    <p className="error-text">
                      Geweigerd. Je kunt dit later aanzetten via Instellingen.
                    </p>
                  )}
                </div>,
              ]
            : []),
          <div className="onb-feature" key="notifs">
            <span className="onb-visual">
              <Icon name="bell" size={54} />
            </span>
            <h1>Meldingen</h1>
            <p className="muted">
              Voor de tracking-status en updates van reisgenoten. Je kunt dit altijd aanpassen in de
              toestelinstellingen.
            </p>
            {permission(perms.notifications, 'Meldingen toestaan', 'Ingesteld', () =>
              void ask('notifications'),
            )}
            {denied.notifications && !perms.notifications && (
              <p className="error-text">
                Geweigerd. Zonder melding kan de tracking niet op de achtergrond draaien.
              </p>
            )}
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
