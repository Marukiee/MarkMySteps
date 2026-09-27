import { useEffect, useState } from 'react';
import './daynote.css';

export interface TripNote {
  id: string;
  day: string;
  title: string | null;
  body: string;
  /** Absent on a shared trip: the public page never learns who wrote what. */
  authorId?: string;
  authorName: string;
}

interface DayNoteProps {
  day: string;
  notes: TripNote[];
  canEdit: boolean;
  ownUserId?: string;
  /** Open the editor immediately (triggered by the pencil in the day header). */
  startEditing?: boolean;
  onEditDone?: () => void;
  /** Both absent on a read-only view such as the public share page. */
  onSave?: (day: string, body: string) => Promise<void>;
  onDelete?: (noteId: string) => Promise<void>;
}

/** Polarsteps-style day story: read others', edit your own note per day. */
export function DayNote({
  day,
  notes,
  canEdit,
  ownUserId,
  startEditing,
  onEditDone,
  onSave,
  onDelete,
}: DayNoteProps) {
  // Without a signed-in user nothing is "own": an undefined id must not match
  // a note whose author id is undefined too.
  const isOwn = (n: TripNote) => ownUserId !== undefined && n.authorId === ownUserId;
  const own = notes.find(isOwn);
  const others = notes.filter((n) => !isOwn(n));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(own?.body ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(own?.body ?? ''), [own?.body]);
  useEffect(() => {
    if (startEditing) setEditing(true);
  }, [startEditing]);

  function stopEditing() {
    setEditing(false);
    onEditDone?.();
  }

  async function save() {
    if (!onSave) return;
    setBusy(true);
    try {
      await onSave(day, draft);
      stopEditing();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="day-note">
      {others.map((n) => (
        <blockquote key={n.id} className="day-note-body">
          {n.body}
          <cite>{n.authorName}</cite>
        </blockquote>
      ))}

      {own && !editing && (
        <blockquote className="day-note-body own">
          {own.body}
          {canEdit && (
            <div className="day-note-actions">
              <button onClick={() => setEditing(true)}>Bewerken</button>
              {onDelete && (
                <button className="danger" onClick={() => void onDelete(own.id)}>
                  Verwijderen
                </button>
              )}
            </div>
          )}
        </blockquote>
      )}

      {canEdit && onSave && editing && (
        <div className="day-note-edit">
          <textarea
            autoFocus
            placeholder="Schrijf iets over deze dag…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
          />
          <div className="day-note-actions">
            <button onClick={stopEditing}>Annuleren</button>
            <button className="primary" disabled={busy || !draft.trim()} onClick={() => void save()}>
              Opslaan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
