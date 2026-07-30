import { App as CapApp } from '@capacitor/app';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { AuthImage } from './AuthImage';
import { isLocalMode } from '../lib/localMode';
import { isNativeApp } from '../lib/native';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import './invitepopup.css';

interface Invite {
  id: string;
  title: string;
  ownerName: string;
  /** A photo from the trip, when it has one. No photo, no empty frame. */
  coverId: string | null;
}

/** Developer options open the real thing with made-up trips on it. */
export const INVITE_PREVIEW_EVENT = 'mms-invite-preview';

export function previewInvitePopup(count: number): void {
  const made: Invite[] = Array.from({ length: count }, (_, i) => ({
    id: `preview-${i}`,
    title: ['Interrail door Midden-Europa', 'Weekend Rome', 'Noorwegen met de auto'][i % 3]!,
    ownerName: ['Mark', 'Sanne', 'Joost'][i % 3]!,
    coverId: null,
  }));
  window.dispatchEvent(new CustomEvent(INVITE_PREVIEW_EVENT, { detail: made }));
}

/**
 * Says once that somebody put you on a trip.
 *
 * The server keeps the "not told yet" flag, so this is the same message on
 * every device you sign in on, and it is only marked seen once you have closed
 * it — a launch that never got to the screen still owes you the news.
 */
export function InvitePopup() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [closing, setClosing] = useState(false);
  const [preview, setPreview] = useState(false);
  const navigate = useNavigate();

  // Developer options put the real dialog on screen with invented trips, so it
  // can be looked at without being added to anything.
  useEffect(() => {
    const onPreview = (e: Event) => {
      setPreview(true);
      setInvites((e as CustomEvent<Invite[]>).detail);
    };
    window.addEventListener(INVITE_PREVIEW_EVENT, onPreview);
    return () => window.removeEventListener(INVITE_PREVIEW_EVENT, onPreview);
  }, []);

  useEffect(() => {
    if (isLocalMode()) return;

    const check = () => {
      api<Invite[]>('/trips/invites')
        .then((list) => {
          // Never replace a list that is on screen: dismissing it is what marks
          // it seen, and swapping it out from under a tap would lose one.
          setInvites((current) => (current.length > 0 ? current : list));
        })
        .catch(() => undefined);
    };

    check();
    if (!isNativeApp()) return;
    // Being added while the app sits in the background is the common case.
    const handle = CapApp.addListener('resume', check);
    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);

  if (invites.length === 0) return null;

  const close = (goTo?: string) => {
    setClosing(true);
    // A preview was never news, so it has nothing to mark as read.
    if (!preview) void api('/trips/invites/seen', { method: 'POST' }).catch(() => undefined);
    window.setTimeout(() => {
      setInvites([]);
      setClosing(false);
      setPreview(false);
      if (goTo && !preview) navigate(goTo);
    }, 180);
  };

  const single = invites.length === 1;

  return (
    <div className={`invite-backdrop ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true">
      <div className="invite-card card">
        <span className="invite-mark">
          <LogoMark size={40} />
        </span>
        <h3>
          Je bent toegevoegd aan {single ? '1 reis' : `${invites.length} reizen`}!
        </h3>
        <ul className="invite-list">
          {invites.map((invite) => (
            <li key={invite.id}>
              {/* A photo when the trip has one; a pin when it does not. An
                  empty frame waiting for a picture that is never coming is
                  worse than no frame at all. */}
              {invite.coverId ? (
                <AuthImage
                  path={`/media/${invite.coverId}/thumbnail`}
                  alt=""
                  className="invite-cover"
                />
              ) : (
                <Icon name="pin" size={15} />
              )}
              <span>
                {invite.title}
                <small>door {invite.ownerName}</small>
              </span>
            </li>
          ))}
        </ul>
        <div className="invite-actions">
          <button className="btn btn-ghost" onClick={() => close()}>
            Later
          </button>
          <button
            className="btn btn-primary"
            onClick={() => close(single ? `/trips/${invites[0]!.id}` : '/')}
          >
            {single ? 'Bekijk de reis' : 'Naar mijn reizen'}
          </button>
        </div>
      </div>
    </div>
  );
}
