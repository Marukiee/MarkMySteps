import { Icon } from './Icon';
import { colorForUser } from '../lib/colors';
import { lastSeenLabel } from '../lib/lastSeen';
import { useSheetDismiss } from '../lib/useSheetDismiss';
import './maplayers.css';

export interface LayerMember {
  userId: string;
  user: { displayName: string };
}

/**
 * What the map is showing, and whose.
 *
 * This used to be a pill in the bottom-left corner of the map, and it was one
 * switch: a traveller was either on the map or not. Two things were wrong with
 * that. It sat permanently over the map for a choice almost nobody changes
 * twice, and it could not say the thing people actually wanted — "the route of
 * all of us, but only my photos", or "no photos at all, just the line".
 *
 * So: two lists, one for the tracked routes and one for the photos, and the
 * photo list may be emptied altogether.
 */
export function MapLayersSheet({
  members,
  routeUsers,
  photoUsers,
  liveFixes,
  liveTick,
  ownUserId,
  onToggleRoute,
  onTogglePhoto,
  onAllPhotos,
  onNoPhotos,
  onClose,
  closing,
}: {
  members: LayerMember[];
  routeUsers: Set<string>;
  photoUsers: Set<string>;
  liveFixes?: { userId: string; recordedAt: string }[];
  liveTick?: number;
  ownUserId?: string;
  onToggleRoute: (userId: string) => void;
  onTogglePhoto: (userId: string) => void;
  onAllPhotos: () => void;
  onNoPhotos: () => void;
  onClose: () => void;
  closing: boolean;
}) {
  const sheet = useSheetDismiss(onClose);

  const row = (
    member: LayerMember,
    on: boolean,
    toggle: (userId: string) => void,
    seen?: { text: string; fresh: boolean } | null,
  ) => (
    <button
      key={member.userId}
      type="button"
      className={`layer-row ${on ? 'on' : ''}`}
      onClick={() => toggle(member.userId)}
      aria-pressed={on}
    >
      <span className="layer-dot" style={{ background: colorForUser(member.userId) }} />
      <span className="layer-name">
        {member.user.displayName}
        {member.userId === ownUserId && ' (ik)'}
      </span>
      {seen && <span className={`layer-seen ${seen.fresh ? 'fresh' : ''}`}>{seen.text}</span>}
      <span className={`layer-check ${on ? 'on' : ''}`}>
        <Icon name="check" size={15} />
      </span>
    </button>
  );

  return (
    <div className={`people-sheet-backdrop ${closing ? 'closing' : ''}`} onClick={onClose}>
      <div
        className="people-sheet card"
        ref={sheet.ref}
        onClick={(e) => e.stopPropagation()}
        {...sheet.handlers}
      >
        <div className="people-sheet-head">
          <h2>Kaartinstellingen</h2>
          <button className="icon-btn" aria-label="Sluiten" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <section className="layer-group">
          <h3 className="trip-side-heading">Routes op de kaart</h3>
          <p className="muted layer-hint">Wiens gevolgde route je ziet.</p>
          {members.map((member) => {
            const fix = liveFixes?.find((f) => f.userId === member.userId);
            const seen = fix ? lastSeenLabel(fix.recordedAt, liveTick ?? 0) : null;
            return row(member, routeUsers.has(member.userId), onToggleRoute, seen);
          })}
        </section>

        <section className="layer-group">
          <h3 className="trip-side-heading">Foto&apos;s op de kaart</h3>
          <p className="muted layer-hint">
            Wiens foto&apos;s als bolletjes op de kaart staan. Zet ze allemaal uit om alleen de
            route te zien.
          </p>
          {members.map((member) => row(member, photoUsers.has(member.userId), onTogglePhoto))}
          <div className="layer-actions">
            <button type="button" className="btn btn-ghost" onClick={onAllPhotos}>
              Allemaal aan
            </button>
            <button type="button" className="btn btn-ghost" onClick={onNoPhotos}>
              Allemaal uit
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
