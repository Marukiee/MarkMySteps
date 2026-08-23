import { useMemo, useState } from 'react';
import type { MediaItem } from '../api/types';
import { colorForUser, formatDay } from '../lib/colors';
import { AuthImage } from './AuthImage';
import { DayNote, TripNote } from './DayNote';
import { Icon } from './Icon';
import { isPanorama, PhotoGrid } from './PhotoGrid';
import { StopJump } from './StopJump';
import { WeatherBadge } from './WeatherBadge';
import './timeline.css';
import { Flag } from './Flag';

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
  /** Whose trip this is when it isn't yours — changes what "empty" means. */
  emptyOwnerName?: string | null;
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
  emptyOwnerName,
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

  // A colour dot per photo says whose it is. With one contributor it says the
  // same thing on every photo, so it says nothing — the trip can have five
  // members and still only one of them ever pointed a camera.
  const manyOwners = useMemo(() => {
    const owners = new Set<string>();
    for (const item of media) {
      if (!visibleUsers.has(item.userId)) continue;
      owners.add(item.userId);
      if (owners.size > 1) return true;
    }
    return false;
  }, [media, visibleUsers]);

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
        {emptyOwnerName
          ? // Not your trip: connecting your own Immich would not fill it, and
            // telling a guest to do so was an instruction they cannot follow.
            `${emptyOwnerName} heeft nog geen foto's toegevoegd aan deze reis.`
          : "Nog geen foto's. Koppel Immich in Instellingen en druk op Sync."}
      </p>
    );
  }

  return (
    <>
      {/* Straight to a city, without scrolling three months to find it. */}
      <StopJump stops={stops} days={days.map(([day]) => day)} />
      <div className="timeline">
      {days.map(([day, items]) => {
        const loc = locationForDay(day, items);
        return (
        // The day and its place are written onto the section so the fast-scroll
        // grip can say where the list is without knowing anything about the
        // timeline.
        <section
          key={day}
          className="timeline-day"
          data-day={day}
          data-place={loc?.name ?? undefined}
        >
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
                      <Flag code={loc.countryCode} size={15} /> {loc.name}
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
          {/* Justified rows rather than a grid of squares: a portrait stays a
              portrait and a panorama stays wide, the way the photos were taken. */}
          <PhotoGrid items={items} className="timeline-grid">
            {(item) => (
              <figure
                data-media-id={item.id}
                className="timeline-photo"
                onClick={() => onPhotoClick?.(item)}
                role={onPhotoClick ? 'button' : undefined}
              >
                <AuthImage
                  // A panorama runs the full width of the screen on a row of
                  // its own, and the small grid rendition is a few hundred
                  // pixels stretched across all of it. It gets the preview,
                  // with the small one held up in front until that arrives.
                  path={
                    isPanorama(item)
                      ? `/media/${item.id}/thumbnail`
                      : `/media/${item.id}/thumbnail?size=thumbnail`
                  }
                  lowResPath={
                    isPanorama(item) ? `/media/${item.id}/thumbnail?size=thumbnail` : undefined
                  }
                  alt=""
                  className="timeline-img"
                />
                {showOwner && manyOwners && (
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
            )}
          </PhotoGrid>
        </section>
        );
      })}
      </div>
    </>
  );
}
