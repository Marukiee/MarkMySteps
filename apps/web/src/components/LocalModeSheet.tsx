import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconName } from './Icon';
import { LogoMark } from './Logo';
import { t } from '../i18n';
import { tr } from '../i18n/rich';
import './localmode.css';

interface Feature {
  icon: IconName;
  title: string;
  body: string;
}

/** What still works with nothing but the phone. */
const WORKS: Feature[] = [
  {
    icon: 'pin',
    title: 'Route-tracking',
    body: t('settings.local.works.tracking'),
  },
  {
    icon: 'compass',
    title: t('settings.local.works.plan.title'),
    body: t('settings.local.works.plan'),
  },
  {
    icon: 'camera',
    title: t('settings.local.works.photos.title'),
    body: t('settings.local.works.photos'),
  },
  {
    icon: 'people',
    title: t('settings.local.works.maps.title'),
    body: t('settings.local.works.maps'),
  },
];

/** What needs a server, and what you get instead in the meantime. */
const NEEDS_SERVER: Feature[] = [
  {
    icon: 'people',
    title: t('settings.local.needs.companions.title'),
    body: t('settings.local.needs.companions'),
  },
  {
    icon: 'share',
    title: 'Deel-links',
    body: t('settings.local.needs.shareLinks'),
  },
  {
    icon: 'archive',
    title: t('settings.local.needs.backup.title'),
    body: t('settings.local.needs.backup'),
  },
  {
    icon: 'camera',
    title: t('settings.immich.title'),
    body: t('settings.local.needs.immich'),
  },
];

/**
 * How to put a server behind this later.
 *
 * Exported because it is also the answer to "how do I get back?" once you are
 * already running without one, so the settings show the same thing.
 */
export function ServerSteps({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`lm-later ${open ? 'open' : ''}`}>
      <button type="button" className="lm-later-head" onClick={() => setOpen((v) => !v)}>
        <Icon name="external" size={16} />
        <span>{t('settings.local.later.title')}</span>
        <Icon name="chevron-right" size={16} className="lm-later-caret" />
      </button>
      <div className="lm-later-body">
        <div>
          <p className="muted lm-note">
            {t('settings.local.later.intro')}
          </p>
          <ol className="lm-steps">
            <li>
              {t('settings.local.later.step1')}
              <code>git clone https://github.com/Marukiee/MarkMySteps.git</code>
            </li>
            <li>{tr('settings.local.later.step2', { code: (s) => <code>{s}</code> })}</li>
            <li>{t('settings.local.later.step3')}</li>
            <li>
              {tr('settings.local.later.step4', {
                path: () => (
                  <span className="lm-path">
                    {t('common.settings')} <Icon name="chevron-right" size={12} />{' '}
                    {t('settings.nav.profile')}
                  </span>
                ),
                b: (s) => <strong>{s}</strong>,
              })}
            </li>
          </ol>
          <p className="muted lm-note">
            {t('settings.local.later.outro')}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * The "no server" explainer, opened from the login screen.
 *
 * The honest version: what you keep, what you give up, and that the choice is
 * not final. That last part matters most: someone who knows they can add a
 * server later will actually try the app now.
 */
export function LocalModeSheet({
  onClose,
  onContinue,
}: {
  onClose: () => void;
  onContinue: () => void;
}) {
  const [closing, setClosing] = useState(false);
  /** Set when the caller is about to navigate: the entry pushed on open must
   *  then stay put, or the navigation is undone by the pop below. */
  const keepHistory = useRef(false);
  const closeRef = useRef<() => void>(() => undefined);

  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 220);
  };
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    // Back closes the sheet rather than leaving the login screen.
    window.history.pushState({ mmsLocalMode: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      if (!popped && !keepHistory.current) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className={`lm-layer ${closing ? 'closing' : ''}`}>
      <div className="lm-scrim" onClick={close} />
      <div className="lm-sheet" role="dialog" aria-modal="true" aria-label={t('settings.local.title')}>
        <div className="lm-grab" aria-hidden="true" />
        <button type="button" className="lm-close" aria-label={t('common.close')} onClick={close}>
          <Icon name="close" size={18} />
        </button>

        <div className="lm-scroll">
          <header className="lm-head">
            <LogoMark size={44} />
            <h2>{t('settings.local.title')}</h2>
            <p className="muted">
              {t('settings.local.sheet.intro')}
            </p>
          </header>

          <section className="lm-group">
            <h3 className="lm-group-title lm-yes">
              <Icon name="check" size={16} /> {t('settings.local.sheet.works')}
            </h3>
            <ul className="lm-list">
              {WORKS.map((f) => (
                <li key={f.title}>
                  <span className="lm-icon lm-icon-yes">
                    <Icon name={f.icon} size={18} />
                  </span>
                  <span>
                    <strong>{f.title}</strong>
                    <small>{f.body}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="lm-group">
            <h3 className="lm-group-title lm-no">
              <Icon name="cloud-off" size={16} /> {t('settings.local.sheet.needs')}
            </h3>
            <ul className="lm-list">
              {NEEDS_SERVER.map((f) => (
                <li key={f.title}>
                  <span className="lm-icon lm-icon-no">
                    <Icon name={f.icon} size={18} />
                  </span>
                  <span>
                    <strong>{f.title}</strong>
                    <small>{f.body}</small>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <ServerSteps />
        </div>

        <footer className="lm-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>
            {t('common.back')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              // The history entry pushed on open must NOT be popped here: the
              // caller navigates away, and popping would have taken that
              // navigation straight back to the login screen.
              keepHistory.current = true;
              onContinue();
            }}
          >
            {t('settings.local.sheet.start')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
