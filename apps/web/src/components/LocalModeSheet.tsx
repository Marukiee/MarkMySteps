import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconName } from './Icon';
import { LogoMark } from './Logo';
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
    body: 'De GPS-tracker draait volledig op je toestel. Punten worden lokaal bewaard, ook zonder internet.',
  },
  {
    icon: 'compass',
    title: 'Reizen plannen',
    body: 'Stops, nachten, vervoer, vluchten en dagtrips. Alles rekent gewoon door.',
  },
  {
    icon: 'camera',
    title: "Foto's uit je galerij",
    body: "Foto's van je toestel worden op datum aan een reis gekoppeld en met hun GPS op de kaart gezet.",
  },
  {
    icon: 'people',
    title: 'Kaart, globe en tijdlijn',
    body: 'De kaarten en de globe halen hun tegels rechtstreeks van OpenStreetMap. Geen account nodig.',
  },
];

/** What needs a server, and what you get instead in the meantime. */
const NEEDS_SERVER: Feature[] = [
  {
    icon: 'people',
    title: 'Reisgenoten',
    body: 'Samen aan één reis werken en elkaars live positie zien kan alleen via een server.',
  },
  {
    icon: 'share',
    title: 'Deel-links',
    body: 'In plaats daarvan exporteer je een reis als één bestand dat je zelf doorstuurt.',
  },
  {
    icon: 'archive',
    title: 'Automatische back-up',
    body: 'Alles staat op je toestel. Maak zelf af en toe een back-up, of koppel later alsnog een server.',
  },
  {
    icon: 'camera',
    title: 'Immich',
    body: "Je eigen Immich-server kun je later koppelen als je je foto's al daar bewaart.",
  },
];

/**
 * Flip to true once localBackend can serve the app. Until then the sheet is
 * honest about it rather than dropping someone into an app with no data layer.
 */
const LOCAL_MODE_READY = false;

/**
 * The "no server" explainer, opened from the login screen.
 *
 * The honest version: what you keep, what you give up, and that the choice
 * isn't final. That last part matters most — someone who knows they can add a
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

  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 220);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    // Back closes the sheet rather than leaving the login screen.
    window.history.pushState({ mmsLocalMode: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      close();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      if (!popped) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className={`lm-layer ${closing ? 'closing' : ''}`}>
      <div className="lm-scrim" onClick={close} />
      <div className="lm-sheet" role="dialog" aria-modal="true" aria-label="Zonder server">
        <div className="lm-grab" aria-hidden="true" />
        <button type="button" className="lm-close" aria-label="Sluiten" onClick={close}>
          <Icon name="close" size={18} />
        </button>

        <div className="lm-scroll">
          <header className="lm-head">
            <LogoMark size={44} />
            <h2>Zonder server</h2>
            <p className="muted">
              Alles blijft op je toestel. Geen account, geen server, niets dat naar buiten gaat.
            </p>
          </header>

          <section className="lm-group">
            <h3 className="lm-group-title lm-yes">
              <Icon name="check" size={16} /> Werkt gewoon
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
              <Icon name="cloud-off" size={16} /> Heeft een server nodig
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

          <section className="lm-later">
            <h3>
              <Icon name="external" size={16} /> Later alsnog een server?
            </h3>
            <ol className="lm-steps">
              <li>
                Zet MarkMySteps op je eigen machine of NAS — één commando:
                <code>./install.sh</code>
              </li>
              <li>
                Ga naar <strong>Instellingen → Account</strong> en vul het adres van je server in.
              </li>
              <li>
                Alles wat je lokaal hebt gemaakt wordt in één keer geüpload. Je raakt niets kwijt,
                en je hoeft niets opnieuw in te voeren.
              </li>
            </ol>
            <p className="muted lm-note">
              Je kunt ook de andere kant op: een server loskoppelen laat je gegevens gewoon op je
              toestel staan.
            </p>
          </section>
        </div>

        <footer className="lm-actions">
          {LOCAL_MODE_READY ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={close}>
                Terug
              </button>
              <button type="button" className="btn btn-primary" onClick={onContinue}>
                Zonder server beginnen
              </button>
            </>
          ) : (
            <div className="lm-soon">
              <span>
                <strong>Bijna zover.</strong> De lokale modus wordt nu gebouwd — dit scherm laat
                alvast zien wat je ervan kunt verwachten.
              </span>
              <button type="button" className="btn btn-ghost" onClick={close}>
                Terug
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
