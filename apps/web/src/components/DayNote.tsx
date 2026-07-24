import { useEffect, useState } from 'react';

export interface TripNote {
  id: string;
  day: string;
  title: string | null;
  body: string;
  authorId: string;
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
  onSave: (day: string, body: string) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
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
  const own = notes.find((n) => n.authorId === ownUserId);
  const others = notes.filter((n) => n.authorId !== ownUserId);
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
          <div className="day-note-actions">
            <button onClick={() => setEditing(true)}>Bewerken</button>
            <button className="danger" onClick={() => void onDelete(own.id)}>
              Verwijderen
            </button>
          </div>
        </blockquote>
      )}

      {canEdit && editing && (
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
