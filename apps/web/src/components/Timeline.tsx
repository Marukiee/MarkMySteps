import { useMemo } from 'react';
import type { MediaItem } from '../api/types';
import { colorForUser, formatDay } from '../lib/colors';
import { AuthImage } from './AuthImage';
import { DayNote, TripNote } from './DayNote';
import './timeline.css';

interface TimelineProps {
  media: MediaItem[];
  visibleUsers: Set<string>;
  onPhotoClick?: (item: MediaItem) => void;
  /** Owner-color dot only makes sense with multiple travellers. */
  showOwner?: boolean;
  notes?: TripNote[];
  canEditNotes?: boolean;
  ownUserId?: string;
  onSaveNote?: (day: string, body: string) => Promise<void>;
  onDeleteNote?: (noteId: string) => Promise<void>;
}

export function Timeline({
  media,
  visibleUsers,
  onPhotoClick,
  showOwner = false,
  notes = [],
  canEditNotes = false,
  ownUserId,
  onSaveNote,
  onDeleteNote,
}: TimelineProps) {
  const days = useMemo(() => {
    const groups = new Map<string, MediaItem[]>();
    for (const item of media) {
      if (!visibleUsers.has(item.userId)) continue;
      const day = item.takenAt.slice(0, 10);
      const list = groups.get(day) ?? [];
      list.push(item);
      groups.set(day, list);
    }
    // Days that only have a note (no photos) still deserve a section.
    for (const note of notes) {
      if (!groups.has(note.day)) groups.set(note.day, []);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [media, visibleUsers, notes]);

  const notesByDay = useMemo(() => {
    const map = new Map<string, TripNote[]>();
    for (const note of notes) {
      map.set(note.day, [...(map.get(note.day) ?? []), note]);
    }
    return map;
  }, [notes]);

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
            {formatDay(items[0]?.takenAt ?? day)}
          </h3>

          {(canEditNotes || (notesByDay.get(day)?.length ?? 0) > 0) && onSaveNote && onDeleteNote && (
            <DayNote
              day={day}
              notes={notesByDay.get(day) ?? []}
              canEdit={canEditNotes}
              ownUserId={ownUserId}
              onSave={onSaveNote}
              onDelete={onDeleteNote}
            />
          )}
          <div className="timeline-grid">
            {items.map((item) => (
              <figure
                key={item.id}
                data-media-id={item.id}
                className="timeline-photo"
                onClick={() => onPhotoClick?.(item)}
                role={onPhotoClick ? 'button' : undefined}
              >
                <AuthImage path={`/media/${item.id}/thumbnail`} alt="" className="timeline-img" />
                {showOwner && (
                  <span
                    className="timeline-owner"
                    style={{ background: colorForUser(item.userId) }}
                  />
                )}
                {item.assetType === 'VIDEO' && <span className="timeline-video">▶</span>}
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
