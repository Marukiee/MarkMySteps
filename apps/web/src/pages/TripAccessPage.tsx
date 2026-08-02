import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { TripAccessPreview } from '../api/types';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { formatDateRange } from '../lib/colors';
import './tripaccess.css';

/**
 * The trip you tapped on a friend's page and are not on.
 *
 * "Trip not found" was true and useless: the trip exists, you have simply not
 * been let onto it. So say that, say whose it is, and offer the one thing that
 * can change it — with a line of your own, if you want. The server only tells
 * this page anything when the trip belongs to somebody you already travel with;
 * anything else really is a 404, and lands on the not-found half below.
 *
 * No card: the page is one column of text in the middle of the screen. A white
 * panel floating near the top made it look like something had failed to load.
 */
export function TripAccessPage({ tripId }: { tripId: string }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<TripAccessPreview | null>(null);
  const [gone, setGone] = useState(false);
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let alive = true;
    api<TripAccessPreview>(`/trips/${tripId}/access`)
      .then((p) => {
        if (!alive) return;
        // Already on it (just approved, say) — no reason to sit on this page.
        if (p.status === 'MEMBER') navigate(`/trips/${p.tripId}`, { replace: true });
        else setPreview(p);
      })
      .catch(() => alive && setGone(true));
    return () => {
      alive = false;
    };
  }, [tripId, navigate]);

  async function ask() {
    setAsking(true);
    setError(null);
    try {
      // Only what you actually typed goes with it — the greyed-out line in the
      // box is an example, not a default.
      await api(`/trips/${tripId}/access`, {
        method: 'POST',
        body: message.trim() ? { message: message.trim() } : {},
      });
      setSent(true);
      setPreview((p) => (p ? { ...p, status: 'PENDING' } : p));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Het verzoek kon niet verstuurd worden');
    } finally {
      setAsking(false);
    }
  }

  /** Back goes where you came from: the traveller whose trip this is. */
  const back = (
    <button type="button" className="ta-back" onClick={() => navigate('/friends')}>
      <Icon name="arrow-left" size={17} /> Terug
    </button>
  );

  if (gone) {
    return (
      <main className="page fade-in trip-access">
        {back}
        <div className="ta-body">
          <span className="ta-glyph ta-glyph-lost" aria-hidden="true">
            <Icon name="compass" size={38} />
          </span>
          <h1>Deze reis bestaat niet</h1>
          <p className="ta-note">
            De link klopt niet meer, of de reis is verwijderd door de organisator.
          </p>
          <button type="button" className="btn btn-primary ta-ask" onClick={() => navigate('/')}>
            Naar mijn reizen
          </button>
        </div>
      </main>
    );
  }

  if (!preview) return <main className="page trip-access">{back}</main>;

  const waiting = preview.status === 'PENDING';
  const denied = preview.status === 'DENIED' && !sent;

  return (
    <main className="page fade-in trip-access">
      {back}

      <div className="ta-body">
        <span className="ta-glyph" aria-hidden="true">
          <Icon name="lock" size={34} />
        </span>

        <h1>{preview.title}</h1>
        <p className="ta-dates">{formatDateRange(preview.startDate, preview.endDate)}</p>

        <div className="ta-owner">
          <Avatar
            userId={preview.owner.id}
            displayName={preview.owner.displayName}
            hasAvatar={preview.owner.hasAvatar}
            size={34}
          />
          <span>
            van <strong>{preview.owner.displayName}</strong>
          </span>
        </div>

        {/* Three states, one column: not asked, waiting, refused. Each one
            replaces the last in place, so nothing above it moves. */}
        <div className="ta-state" key={waiting ? 'waiting' : denied ? 'denied' : 'ask'}>
          {waiting ? (
            <>
              <p className="ta-status ta-status-wait">
                <Icon name="hourglass" size={15} />
                Je verzoek staat klaar bij {preview.owner.displayName}.
              </p>
              <p className="ta-note">
                Zodra het beantwoord is krijg je een melding bij Reizigers.
              </p>
            </>
          ) : (
            <>
              {denied && (
                <p className="ta-status ta-status-no">
                  <Icon name="close" size={15} />
                  Je eerdere verzoek is afgewezen. Je mag het opnieuw vragen.
                </p>
              )}
              <p className="ta-note">
                Je bent geen reisgenoot of gast op deze reis, dus je ziet de route en de foto&apos;s
                niet. Vraag {preview.owner.displayName} om je toe te laten.
              </p>
              <div className="field ta-field">
                <label htmlFor="ta-msg">Bericht (optioneel)</label>
                <input
                  id="ta-msg"
                  value={message}
                  maxLength={300}
                  placeholder="Hoi! Mag ik meekijken?"
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button
                type="button"
                className="btn btn-primary ta-ask"
                disabled={asking}
                onClick={() => void ask()}
              >
                {asking ? 'Versturen…' : 'Toegang vragen'}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
