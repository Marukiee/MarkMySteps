import { FormEvent, useEffect, useState } from 'react';
import { confirmModal } from './confirm';
import { api } from '../api/client';
import type { ShareLinkInfo } from '../api/types';
import { webBase } from '../lib/native';
import { Icon } from './Icon';
import './share.css';

export function SharePanel({ tripId }: { tripId: string }) {
  const [links, setLinks] = useState<ShareLinkInfo[]>([]);
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setLinks((current) => current.filter((l) => l.id !== id));
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

  async function removeLinkConfirmed(id: string) {
    const ok = await confirmModal({
      title: 'Link intrekken?',
      body: 'Wie de link heeft kan de reis daarna niet meer bekijken.',
      confirmLabel: 'Intrekken',
      danger: true,
    });
    if (ok) await removeLink(id);
  }

  return (
    <section className="share-panel">
      <h2 className="trip-side-heading">Delen</h2>
      <p className="muted share-hint">
        Publieke, alleen-lezen link voor thuisblijvers, zonder account.
      </p>

      {links.map((link) => (
        <div key={link.id} className="share-link card share-link-in">
          <span className="share-url">{`${webBase().replace(/^https?:\/\//, '')}${link.url}`}</span>
          {link.hasPassword && (
            <span className="share-lock" title="Met wachtwoord">
              <Icon name="lock" size={14} />
            </span>
          )}
          <button className="btn btn-ghost share-btn" onClick={() => copy(link)}>
            {copied === link.id ? (
              <>
                <Icon name="check" size={15} /> Gekopieerd
              </>
            ) : (
              'Kopieer'
            )}
          </button>
          <button
            className="share-delete"
            onClick={() => void removeLinkConfirmed(link.id)}
            aria-label="Link intrekken"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}

      <form className="share-create" onSubmit={createLink}>
        <input
          type="password"
          placeholder="wachtwoord (optioneel)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn btn-ghost">
          <Icon name="plus" size={16} /> Deellink
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
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
    /* nothing we can do — the URL is on screen to copy by hand */
  }
  field.remove();
}
