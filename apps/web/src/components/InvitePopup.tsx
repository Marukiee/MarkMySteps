import { App as CapApp } from '@capacitor/app';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { isLocalMode } from '../lib/localMode';
import { isNativeApp } from '../lib/native';
import { Icon } from './Icon';
import { LogoMark } from './Logo';
import './invitepopup.css';

interface Invite {
  id: string;
  title: string;
  ownerName: string;
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
  const navigate = useNavigate();

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
    void api('/trips/invites/seen', { method: 'POST' }).catch(() => undefined);
    window.setTimeout(() => {
      setInvites([]);
      setClosing(false);
      if (goTo) navigate(goTo);
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
              <Icon name="pin" size={15} />
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
