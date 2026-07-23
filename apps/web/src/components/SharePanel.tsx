import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ShareLinkInfo } from '../api/types';
import { webBase } from '../lib/native';
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
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(link.id);
      window.setTimeout(() => setCopied(null), 1600);
    });
  }

  return (
    <section className="share-panel">
      <h2 className="trip-side-heading">Delen</h2>
      <p className="muted share-hint">
        Publieke, alleen-lezen link — voor thuisblijvers, zonder account.
      </p>

      {links.map((link) => (
        <div key={link.id} className="share-link card">
          <span className="share-url">{`${webBase().replace(/^https?:\/\//, '')}${link.url}`}</span>
          {link.hasPassword && <span className="share-lock" title="Met wachtwoord">🔒</span>}
          <button className="btn btn-ghost share-btn" onClick={() => copy(link)}>
            {copied === link.id ? 'Gekopieerd ✓' : 'Kopieer'}
          </button>
          <button
            className="share-delete"
            onClick={() => void removeLink(link.id)}
            title="Link intrekken"
          >
            ✕
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
        <button className="btn btn-ghost">+ Deellink</button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
