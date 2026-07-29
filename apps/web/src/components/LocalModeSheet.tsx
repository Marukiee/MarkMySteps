import { useEffect, useRef, useState } from 'react';
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
    body: 'Je locatie wordt op je toestel bewaard, ook als je geen internet hebt. De tracker draait volledig op je telefoon.',
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
    body: 'Samen aan één reis werken en elkaars live positie zien. Daar zijn twee toestellen voor nodig die elkaar ergens kunnen vinden.',
  },
  {
    icon: 'share',
    title: 'Deel-links',
    body: 'In plaats daarvan zet je een reis in één bestand dat je zelf doorstuurt.',
  },
  {
    icon: 'archive',
    title: 'Automatische back-up',
    body: 'Alles staat op je toestel. Maak zelf af en toe een back-up via Instellingen.',
  },
  {
    icon: 'camera',
    title: 'Immich',
    body: "Bewaar je je foto's al op een eigen Immich-server, dan kun je die later koppelen.",
  },
];

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
            <p className="muted lm-note">
              Een server is gewoon een computer die altijd aan staat. Een oude laptop met Linux en
              Docker werkt prima; een Raspberry Pi of een NAS ook.
            </p>
            <ol className="lm-steps">
              <li>
                Installeer Docker op dat toestel en haal de code op:
                <code>git clone https://github.com/Marukiee/MarkMySteps.git</code>
              </li>
              <li>
                Draai in die map <code>./install.sh</code>. Dat vraagt om het adres waarop je de app
                wilt bereiken en zet daarna alles zelf klaar.
              </li>
              <li>
                Maak op dat adres een account aan. Vanaf dat moment kun je ook mensen uitnodigen.
              </li>
              <li>
                Ga in de app naar
                <span className="lm-path">
                  Instellingen <Icon name="chevron-right" size={12} /> Profiel
                </span>
                , kies <strong>Server koppelen</strong> en vul dat adres in.
              </li>
            </ol>
            <p className="muted lm-note">
              Je reizen gaan in één keer mee. Je hoeft niets opnieuw in te voeren, en je kunt ook
              weer terug: een server loskoppelen laat alles gewoon op je toestel staan.
            </p>
          </section>
        </div>

        <footer className="lm-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Terug
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
            Zonder server beginnen
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
