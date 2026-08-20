import { FormEvent, useEffect, useRef, useState } from 'react';
import { confirmModal } from './confirm';
import { api } from '../api/client';
import type { ShareLinkInfo } from '../api/types';
import { webBase } from '../lib/native';
import { Icon } from './Icon';
import './share.css';

/**
 * The trip's public links.
 *
 * The owner makes and revokes them; a travel companion sees the same list and
 * can hand a link on, including the password that goes with it, because they
 * are on the trip the link is about.
 */
export function SharePanel({ tripId, ownerView }: { tripId: string; ownerView: boolean }) {
  const [links, setLinks] = useState<ShareLinkInfo[]>([]);
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A link being revoked stays in the list until its exit animation is done,
  // so the row collapses instead of blinking out from under your thumb.
  const [leaving, setLeaving] = useState<string[]>([]);

  useEffect(() => {
    api<ShareLinkInfo[]>(`/trips/${tripId}/share`).then(setLinks).catch(() => undefined);
  }, [tripId]);

  async function createLink(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const link = await api<ShareLinkInfo>(`/trips/${tripId}/share`, {
        method: 'POST',
        body: password ? { password } : {},
      });
      setLinks((current) => [link, ...current]);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aanmaken mislukt');
    }
  }

  async function removeLink(id: string) {
    await api(`/trips/${tripId}/share/${id}`, { method: 'DELETE' });
    setLeaving((current) => [...current, id]);
    window.setTimeout(() => {
      setLinks((current) => current.filter((l) => l.id !== id));
      setLeaving((current) => current.filter((x) => x !== id));
    }, 260);
  }

  async function revealPassword(id: string) {
    return api<{ password: string | null; recoverable: boolean }>(
      `/trips/${tripId}/share/${id}/password`,
    );
  }

  async function savePassword(id: string, value: string | null) {
    const updated = await api<ShareLinkInfo>(`/trips/${tripId}/share/${id}`, {
      method: 'PATCH',
      body: { password: value },
    });
    setLinks((current) => current.map((l) => (l.id === id ? updated : l)));
  }

  function copy(link: ShareLinkInfo) {
    const url = `${webBase()}${link.url}`;
    const flash = () => {
      setCopied(link.id);
      window.setTimeout(() => setCopied(null), 1600);
    };
    // navigator.clipboard is undefined over plain http and in some WebViews;
    // without this the copy button silently did nothing there.
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).then(flash).catch(() => legacyCopy(url, flash));
    } else {
      legacyCopy(url, flash);
    }
  }

  // A companion gets the panel only once there is something in it: an empty
  // "Delen" heading with nothing under it reads as a broken feature, while the
  // owner needs the empty state to make the first link from.
  if (links.length === 0 && !ownerView) return null;

  return (
    <section className="share-panel">
      <h2 className="trip-side-heading">Delen</h2>
      <p className="muted share-hint">
        {ownerView
          ? 'Publieke, alleen-lezen link voor thuisblijvers, zonder account.'
          : 'De link die de beheerder maakte. Doorsturen mag; wijzigen doet de beheerder.'}
      </p>

      {links.map((link) => (
        <ShareLinkRow
          key={link.id}
          link={link}
          leaving={leaving.includes(link.id)}
          copied={copied === link.id}
          onCopy={() => copy(link)}
          onSavePassword={(value) => savePassword(link.id, value)}
          onRemove={() => removeLink(link.id)}
          onReveal={() => revealPassword(link.id)}
        />
      ))}

      {ownerView && (
        <>
          <form className="share-create" onSubmit={createLink}>
            <input
              type="text"
              className="share-create-pw"
              placeholder="wachtwoord (optioneel)"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="share-dice"
              aria-label="Wachtwoord verzinnen"
              title="Wachtwoord verzinnen"
              onClick={() => setPassword(makePassphrase())}
            >
              <Icon name="sparkle" size={15} />
            </button>
            <button className="btn btn-ghost">
              <Icon name="plus" size={16} /> Deellink
            </button>
          </form>
          <p className="muted share-warn">
            Het wachtwoord is later terug te lezen, dus het staat leesbaar op je server. Gebruik er
            een die je nergens anders gebruikt, of laat er een verzinnen.
          </p>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

/**
 * One link, and everything you can do to it.
 *
 * The URL is written as a link rather than as grey monospace: it is the one
 * thing on this row you might want to open, and it read as disabled text.
 * Everything that is not "copy this" now lives behind the cog, because
 * revoking used to be a bin icon sitting one thumb-width from the button you
 * actually press.
 */
function ShareLinkRow({
  link,
  leaving,
  copied,
  onCopy,
  onSavePassword,
  onRemove,
  onReveal,
}: {
  link: ShareLinkInfo;
  leaving: boolean;
  copied: boolean;
  onCopy: () => void;
  onSavePassword: (password: string | null) => Promise<void>;
  onRemove: () => Promise<void>;
  onReveal: () => Promise<{ password: string | null; recoverable: boolean }>;
}) {
  const [menu, setMenu] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The password, once it has been asked for. `null` inside the object means
  // the link predates recoverable passwords.
  const [secret, setSecret] = useState<{ password: string | null } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  function closeMenu() {
    if (menuClosing) return;
    setMenuClosing(true);
    window.setTimeout(() => {
      setMenu(false);
      setMenuClosing(false);
      setEditing(false);
      setValue('');
      setFailed(null);
      // The password goes back in the drawer with the menu. Leaving it on
      // screen for the next open would put it in front of whoever picks the
      // phone up after you.
      setSecret(null);
      setSecretCopied(false);
    }, 140);
  }

  // A tap anywhere else puts the menu away, the same as the other popovers on
  // this page. Bound while open only, so it costs nothing the rest of the time.
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeMenu();
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  });

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setFailed(null);
    setBusy(true);
    try {
      await onSavePassword(value);
      closeMenu();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Opslaan mislukt');
    } finally {
      setBusy(false);
    }
  }

  async function clearPassword() {
    setBusy(true);
    try {
      await onSavePassword(null);
      closeMenu();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Opslaan mislukt');
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    setFailed(null);
    setBusy(true);
    try {
      const answer = await onReveal();
      setSecret({ password: answer.recoverable ? answer.password : null });
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Ophalen mislukt');
    } finally {
      setBusy(false);
    }
  }

  function copySecret(password: string) {
    const flash = () => {
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(password).then(flash).catch(() => legacyCopy(password, flash));
    } else {
      legacyCopy(password, flash);
    }
  }

  async function revoke() {
    closeMenu();
    const ok = await confirmModal({
      title: 'Link intrekken?',
      body: 'Wie de link heeft kan de reis daarna niet meer bekijken.',
      confirmLabel: 'Intrekken',
      danger: true,
    });
    if (ok) await onRemove();
  }

  const shown = `${webBase().replace(/^https?:\/\//, '')}${link.url}`;

  return (
    <div ref={wrapRef} className={`share-link card ${leaving ? 'leaving' : ''}`}>
      <a
        className="share-url"
        href={`${webBase()}${link.url}`}
        target="_blank"
        rel="noreferrer"
        title={shown}
      >
        {shown}
      </a>
      {link.hasPassword && (
        <span className="share-lock" title="Met wachtwoord">
          <Icon name="lock" size={13} />
        </span>
      )}
      <button className="btn btn-primary share-btn" onClick={onCopy}>
        {copied ? (
          <>
            <Icon name="check" size={15} /> Gekopieerd
          </>
        ) : (
          'Kopieer'
        )}
      </button>
      <button
        type="button"
        className={`share-cog ${menu && !menuClosing ? 'open' : ''}`}
        aria-label="Instellingen van deze link"
        aria-expanded={menu && !menuClosing}
        onClick={() => (menu ? closeMenu() : setMenu(true))}
      >
        <Icon name="gear" size={16} />
      </button>

      {menu && (
        <div className={`share-menu card ${menuClosing ? 'closing' : ''}`}>
          {editing ? (
            <form className="share-menu-form" onSubmit={submitPassword}>
              <label htmlFor={`sp-${link.id}`}>
                {link.hasPassword ? 'Nieuw wachtwoord' : 'Wachtwoord'}
              </label>
              <div className="share-menu-pw">
                <input
                  id={`sp-${link.id}`}
                  type="text"
                  autoFocus
                  minLength={4}
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <button
                  type="button"
                  className="share-dice"
                  aria-label="Wachtwoord verzinnen"
                  onClick={() => setValue(makePassphrase())}
                >
                  <Icon name="sparkle" size={15} />
                </button>
              </div>
              <div className="share-menu-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                  Terug
                </button>
                <button className="btn btn-primary" disabled={busy}>
                  Opslaan
                </button>
              </div>
              {failed && <p className="error-text">{failed}</p>}
            </form>
          ) : (
            <>
              {/* Whoever is on the trip may read the password back: the link is
                  already out there, and resetting it to remember what it was
                  would lock out everyone who has it. */}
              {link.hasPassword &&
                (secret ? (
                  <div className="share-secret">
                    {secret.password === null ? (
                      <p className="share-secret-gone">
                        Dit wachtwoord is van voor deze functie en niet meer terug te lezen.
                        {link.canManage ? ' Stel een nieuw wachtwoord in.' : ''}
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="share-secret-value"
                        title="Kopieer wachtwoord"
                        onClick={() => copySecret(secret.password!)}
                      >
                        <code>{secret.password}</code>
                        <Icon name={secretCopied ? 'check' : 'share'} size={14} />
                      </button>
                    )}
                  </div>
                ) : (
                  <button type="button" disabled={busy} onClick={() => void reveal()}>
                    <Icon name="eye" size={15} />
                    Wachtwoord bekijken
                  </button>
                ))}
              {link.canManage && (
                <>
                  <button type="button" onClick={() => setEditing(true)}>
                    <Icon name="lock" size={15} />
                    {link.hasPassword ? 'Wachtwoord wijzigen' : 'Wachtwoord instellen'}
                  </button>
                  {link.hasPassword && (
                    <button type="button" disabled={busy} onClick={() => void clearPassword()}>
                      <Icon name="close" size={15} />
                      Wachtwoord verwijderen
                    </button>
                  )}
                  <button type="button" className="share-menu-danger" onClick={() => void revoke()}>
                    <Icon name="trash" size={15} />
                    Link intrekken
                  </button>
                </>
              )}
              {failed && <p className="error-text">{failed}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A password worth sending in a message: three easy words and a number.
 *
 * Made here rather than typed, because this one is stored in a form the server
 * can read back, and nobody should be handing that a password they use
 * anywhere else.
 */
const WORDS = [
  'kade', 'noorderlicht', 'zandpad', 'veerpont', 'duinroos', 'sneeuwuil', 'kompas', 'baken',
  'zeewind', 'kiezel', 'bergpas', 'wolkbreuk', 'houtvuur', 'ochtendmist', 'sterrenkaart',
  'landweg', 'brugwachter', 'rugzak', 'zonsopgang', 'waterval', 'olijfgaard', 'fjord',
];

function makePassphrase(): string {
  const pick = () => {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return WORDS[bytes[0]! % WORDS.length]!;
  };
  const digits = new Uint32Array(1);
  crypto.getRandomValues(digits);
  return `${pick()}-${pick()}-${(digits[0]! % 90) + 10}`;
}

/** Clipboard fallback for contexts without navigator.clipboard. */
function legacyCopy(text: string, done: () => void): void {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    /* nothing we can do, the URL is on screen to copy by hand */
  }
  field.remove();
}
