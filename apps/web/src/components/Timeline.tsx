import { useMemo, useState } from 'react';
import type { MediaItem } from '../api/types';
import { colorForUser, flagEmoji, formatDay } from '../lib/colors';
import { AuthImage } from './AuthImage';
import { DayNote, TripNote } from './DayNote';
import { Icon } from './Icon';
import { WeatherBadge } from './WeatherBadge';
import './timeline.css';

export interface TimelineStop {
  name: string;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  arrivalDate: string;
  departureDate: string;
}

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
  stops?: TimelineStop[];
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
  stops = [],
}: TimelineProps) {
  // Resolve a day's location: prefer the planned stop covering that day,
  // else the coordinates of the first photo taken that day.
  const locationForDay = (day: string, dayMedia: MediaItem[]) => {
    // Every stop that covers this day, in order. A day trip is stored with zero
    // nights (arrival == departure), so it has to be matched on its arrival day
    // as well — otherwise its photos end up labelled with the city you slept in.
    const onDay = stops.filter((s) => {
      const from = s.arrivalDate.slice(0, 10);
      const to = s.departureDate.slice(0, 10);
      return day === from || (day > from && day < to);
    });
    const located = onDay.filter((s) => s.latitude !== null && s.longitude !== null);
    if (located.length > 0) {
      const last = located[located.length - 1]!;
      return {
        // "Gränna · Stockholm" when you passed through somewhere that day.
        name: located.map((s) => s.name).join(' · '),
        countryCode: last.countryCode,
        lat: last.latitude!,
        lon: last.longitude!,
      };
    }
    const withGps = dayMedia.find((m) => m.latitude !== null && m.longitude !== null);
    if (withGps) {
      return { name: null, countryCode: null, lat: withGps.latitude!, lon: withGps.longitude! };
    }
    return null;
  };
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

  const [editingDay, setEditingDay] = useState<string | null>(null);

  if (days.length === 0) {
    return (
      <p className="muted timeline-empty">
        Nog geen foto's. Koppel Immich in Instellingen en druk op Sync.
      </p>
    );
  }

  return (
    <div className="timeline">
      {days.map(([day, items]) => {
        const loc = locationForDay(day, items);
        return (
        <section key={day} className="timeline-day">
          <h3>
            <span className="timeline-dot" />
            <span className="timeline-day-label">
              <span className="timeline-day-top">
                {/* The "write something about today" pencil is gone — existing
                    notes still show and stay editable. */}
                {formatDay(items[0]?.takenAt ?? day)}
              </span>
              {loc && (
                <span className="timeline-day-meta">
                  {loc.name && (
                    <span className="timeline-place">
                      {flagEmoji(loc.countryCode)} {loc.name}
                    </span>
                  )}
                  <WeatherBadge lat={loc.lat} lon={loc.lon} day={day} />
                </span>
              )}
            </span>
          </h3>

          {((notesByDay.get(day)?.length ?? 0) > 0 || editingDay === day) &&
            onSaveNote &&
            onDeleteNote && (
              <DayNote
                day={day}
                notes={notesByDay.get(day) ?? []}
                canEdit={canEditNotes}
                ownUserId={ownUserId}
                startEditing={editingDay === day}
                onEditDone={() => setEditingDay((d) => (d === day ? null : d))}
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
                {item.assetType === 'VIDEO' && (
                  <span className="timeline-video">
                    <Icon name="play" size={22} />
                  </span>
                )}
              </figure>
            ))}
          </div>
        </section>
        );
      })}
    </div>
  );
}
