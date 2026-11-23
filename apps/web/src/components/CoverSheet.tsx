import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { MediaItem } from '../api/types';
import { AuthImage } from './AuthImage';
import { Icon } from './Icon';
import { useBackToClose } from '../lib/backStack';
import { haptic } from '../lib/haptics';
import { t } from '../i18n';
import './coversheet.css';

/** How long the sheet takes to slide away (global.css --dur-sheet-out). */
const CLOSE_MS = 380;

/**
 * The trip's photos to pick the cover from; Automatisch lets the server
 * choose. A sheet from the bottom with the app's one sheet motion: back, a tap
 * beside it or a choice slides it away.
 */
export function CoverSheet({
  tripId,
  current,
  onClose,
  onPicked,
}: {
  tripId: string;
  /** The cover picked by hand, null when the server chooses. */
  current: string | null;
  onClose: () => void;
  onPicked: () => void;
}) {
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(current);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    api<MediaItem[]>(`/trips/${tripId}/media`)
      .then((list) => setMedia(list.filter((m) => m.assetType === 'IMAGE')))
      .catch(() => setMedia([]));
  }, [tripId]);

  function close() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, CLOSE_MS);
  }

  useBackToClose('mmsCoverSheet', close);

  async function choose(id: string | null) {
    if (id !== chosen) haptic('light');
    setChosen(id);
    try {
      await api(`/trips/${tripId}`, { method: 'PATCH', body: { coverMediaId: id } });
      onPicked();
    } finally {
      close();
    }
  }

  return createPortal(
    <div className={`cover-sheet-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <div className="cover-sheet card" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="cover-sheet-head">
          <h2>{t('tripSettings.cover.title')}</h2>
          <button
            type="button"
            className={`cover-sheet-auto ${chosen === null ? 'on' : ''}`}
            onClick={() => void choose(null)}
          >
            {chosen === null && <Icon name="check" size={16} strokeWidth={2.4} />}
            {t('common.automatic')}
          </button>
        </div>
        <div className="cover-sheet-grid">
          {media === null &&
            Array.from({ length: 9 }, (_, i) => <span key={i} className="cover-sheet-slot" />)}
          {media?.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`cover-sheet-photo ${chosen === m.id ? 'on' : ''}`}
              onClick={() => void choose(m.id)}
              aria-pressed={chosen === m.id}
            >
              <AuthImage path={`/media/${m.id}/thumbnail`} alt="" />
              {chosen === m.id && (
                <span className="cover-sheet-tick" aria-hidden="true">
                  <Icon name="check" size={16} strokeWidth={2.6} />
                </span>
              )}
            </button>
          ))}
        </div>
        {media?.length === 0 && <p className="muted cover-sheet-empty">{t('tripSettings.cover.empty')}</p>}
      </div>
    </div>,
    document.body,
  );
}
