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
  onSave: (day: string, body: string) => Promise<void>;
  onDelete: (noteId: string) => Promise<void>;
}

/** Polarsteps-style day story: read others', edit your own note per day. */
export function DayNote({ day, notes, canEdit, ownUserId, onSave, onDelete }: DayNoteProps) {
  const own = notes.find((n) => n.authorId === ownUserId);
  const others = notes.filter((n) => n.authorId !== ownUserId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(own?.body ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(own?.body ?? ''), [own?.body]);

  async function save() {
    setBusy(true);
    try {
      await onSave(day, draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="day-note">
      {others.map((n) => (
        <blockquote key={n.id} className="day-note-body">
          {n.body}
          <cite>— {n.authorName}</cite>
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

      {canEdit && (editing || !own) && (
        <div className="day-note-edit">
          <textarea
            placeholder="Schrijf iets over deze dag…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
          />
          <div className="day-note-actions">
            {editing && (
              <button onClick={() => setEditing(false)}>Annuleren</button>
            )}
            <button className="primary" disabled={busy || !draft.trim()} onClick={() => void save()}>
              {own ? 'Opslaan' : 'Toevoegen'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
