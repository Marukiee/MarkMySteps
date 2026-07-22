import { useMemo } from 'react';
import type { MediaItem } from '../api/types';
import { colorForUser, formatDay } from '../lib/colors';
import { AuthImage } from './AuthImage';
import './timeline.css';

export function Timeline({
  media,
  visibleUsers,
  onPhotoClick,
}: {
  media: MediaItem[];
  visibleUsers: Set<string>;
  onPhotoClick?: (item: MediaItem) => void;
}) {
  const days = useMemo(() => {
    const groups = new Map<string, MediaItem[]>();
    for (const item of media) {
      if (!visibleUsers.has(item.userId)) continue;
      const day = item.takenAt.slice(0, 10);
      const list = groups.get(day) ?? [];
      list.push(item);
      groups.set(day, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [media, visibleUsers]);

  if (days.length === 0) {
    return (
      <p className="muted timeline-empty">
        Nog geen foto's — koppel Immich in Instellingen en druk op Sync.
      </p>
    );
  }

  return (
    <div className="timeline">
      {days.map(([day, items]) => (
        <section key={day} className="timeline-day">
          <h3>
            <span className="timeline-dot" />
            {formatDay(items[0]!.takenAt)}
          </h3>
          <div className="timeline-grid">
            {items.map((item) => (
              <figure
                key={item.id}
                className="timeline-photo"
                onClick={() => onPhotoClick?.(item)}
                role={onPhotoClick ? 'button' : undefined}
              >
                <AuthImage path={`/media/${item.id}/thumbnail`} alt="" className="timeline-img" />
                <span
                  className="timeline-owner"
                  style={{ background: colorForUser(item.userId) }}
                />
                {item.assetType === 'VIDEO' && <span className="timeline-video">▶</span>}
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
