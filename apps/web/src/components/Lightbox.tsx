import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ConnectionStatus, MediaItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDay } from '../lib/colors';
import { AuthImage } from './AuthImage';
import './lightbox.css';

interface LightboxProps {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function Lightbox({ items, index, onClose, onNavigate }: LightboxProps) {
  const { user } = useAuth();
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const item = items[index];

  // Own Immich server URL → deep link to the asset. Only for own photos;
  // friends' photos live on their server.
  useEffect(() => {
    api<ConnectionStatus>('/immich/connection')
      .then((s) => setImmichUrl(s.serverUrl))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) setImmichUrl(null);
      });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onNavigate]);

  if (!item) return null;
  const isOwn = item.userId === user?.id;

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button className="lightbox-close" aria-label="Sluiten">
        ✕
      </button>

      {index > 0 && (
        <button
          className="lightbox-nav lightbox-prev"
          aria-label="Vorige"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index - 1);
          }}
        >
          ‹
        </button>
      )}
      {index < items.length - 1 && (
        <button
          className="lightbox-nav lightbox-next"
          aria-label="Volgende"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(index + 1);
          }}
        >
          ›
        </button>
      )}

      <figure className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <AuthImage path={`/media/${item.id}/thumbnail`} alt="" className="lightbox-img" />
        {item.assetType === 'VIDEO' && (
          <p className="lightbox-videohint">Video — afspelen kan in Immich</p>
        )}
        <figcaption className="lightbox-bar">
          <span>{formatDay(item.takenAt)}</span>
          <span className="lightbox-count">
            {index + 1} / {items.length}
          </span>
          {isOwn && immichUrl && (
            <a
              className="btn btn-primary lightbox-immich"
              href={`${immichUrl}/photos/${item.immichAssetId}`}
              target="_blank"
              rel="noreferrer"
            >
              Openen in Immich ↗
            </a>
          )}
        </figcaption>
      </figure>
    </div>
  );
}
