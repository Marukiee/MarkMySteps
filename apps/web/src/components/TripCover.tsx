import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Trip, TripMember } from '../api/types';
import { formatDate, tripCoverBg } from '../lib/colors';
import { useCoverTone } from '../lib/coverTone';
import type { Fact } from '../lib/tripFacts';
import { tripGlyph, tripGlyphSize, tripGlyphStroke } from '../lib/tripGlyph';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { SmartImage } from './SmartImage';
import './tripcover.css';

/**
 * The top of a trip page, as on the native apps: the cover photo as a card
 * with the name and dates over a soft gradient and the travellers' faces in
 * the corner, and right under it the figures as one connected row of tiles in
 * the cover's own tone.
 */
export function TripCover({
  trip,
  facts,
  onPeople,
}: {
  trip: Trip;
  /** The figures, or null while the page is still counting them. */
  facts: Fact[] | null;
  onPeople?: () => void;
}) {
  const coverId = trip.resolvedCoverId;
  const tone = useCoverTone(coverId) ?? trip.color ?? null;
  const people = trip.members.filter((m) => m.role !== 'GUEST');
  return (
    <div className="td-cover-block">
      <div className={`td-cover ${coverId ? 'has-photo' : 'no-photo'}`}
        style={coverId ? undefined : { background: tripCoverBg(trip) }}
      >
        {coverId ? (
          <SmartImage
            candidates={[`/media/${coverId}/thumbnail`, `/media/${coverId}/thumbnail?size=thumbnail`]}
            className="td-cover-img"
            eager
          />
        ) : (
          <span className="td-cover-glyph" aria-hidden="true">
            <Icon
              name={tripGlyph(trip.title)}
              size={tripGlyphSize(trip.title, 190)}
              strokeWidth={tripGlyphStroke(trip.title)}
            />
          </span>
        )}
        <span className="td-cover-shade" aria-hidden="true" />
        {people.length > 0 && (
          <Faces people={people} onClick={onPeople} />
        )}
        <div className="td-cover-text">
          <h1>{trip.title}</h1>
          <p>{t('common.dateRange', { from: formatDate(trip.startDate), to: formatDate(trip.endDate) })}</p>
        </div>
      </div>
      <FactTiles tripId={trip.id} facts={facts} tone={tone} />
    </div>
  );
}

/** Two faces and then "+n"; three people show all three. */
function Faces({ people, onClick }: { people: TripMember[]; onClick?: () => void }) {
  const faces = people.slice(0, people.length <= 3 ? 3 : 2);
  const more = people.length - faces.length;
  return (
    <button
      type="button"
      className="td-cover-faces"
      onClick={onClick}
      disabled={!onClick}
      aria-label={t('trip.people')}
    >
      {faces.map((m) => (
        <span className="td-face" key={m.userId}>
          <Avatar userId={m.userId} displayName={m.user.displayName} hasAvatar={m.user.hasAvatar} size={32} />
        </span>
      ))}
      {more > 0 && <span className="td-face td-face-more">+{more}</span>}
    </button>
  );
}

/* ---- The figures ---- */

interface Shown {
  id: string;
  value: string | null;
  label: string;
}

const MEMORY = 'mms.tripFactTiles.';

function recall(tripId: string): Shown[] | null {
  try {
    const raw = localStorage.getItem(MEMORY + tripId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Shown[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function keep(tripId: string, facts: Fact[]): void {
  try {
    localStorage.setItem(
      MEMORY + tripId,
      JSON.stringify(facts.map((f) => ({ id: f.id, value: f.value, label: f.label }))),
    );
  } catch {
    // Not kept: the next visit counts again, as it did before.
  }
}

/** The labels the tiles stand with before anything is known, values waiting. */
const GUESS: Shown[] = [
  { id: 'days', value: null, label: t('trip.facts.days', { count: 2 }) },
  { id: 'stops', value: null, label: t('trip.facts.stops') },
  { id: 'photos', value: null, label: t('trip.facts.photos', { count: 2 }) },
];

/** The page settles for this long before a number that changes rolls over. */
const SETTLE_MS = 900;

function FactTiles({ tripId, facts, tone }: { tripId: string; facts: Fact[] | null; tone: string | null }) {
  // What this page counted last time stands from the first frame.
  const [memory] = useState(() => recall(tripId));
  const opened = useRef(performance.now());
  useEffect(() => {
    if (facts && facts.length > 0) keep(tripId, facts);
  }, [tripId, facts]);
  // While the page counts again (after a change in the planner), what it
  // showed a moment ago stays, rather than last visit's figures.
  const lastRef = useRef<Shown[] | null>(null);
  if (facts) lastRef.current = facts.map((f) => ({ id: f.id, value: f.value, label: f.label }));
  const list: Shown[] = lastRef.current ?? memory ?? GUESS;
  if (facts && facts.length === 0) return null;
  const style = tone ? ({ '--td-tone': tone } as CSSProperties) : undefined;
  const signature = list.map((f) => f.id).join(',');
  return (
    <div className={`td-facts ${tone ? 'toned' : ''}`} style={style} key={signature}>
      {list.map((f) => (
        <div className="td-fact" key={f.id}>
          <RollingNumber value={f.value} opened={opened.current} />
          <span className="td-fact-label">{f.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A number that changes while you look rolls to its new value: up for more,
 * down for less, 420 ms. Not straight after opening: it waits until the page
 * stands, about 900 ms in. Unknown is empty space of the number's own height.
 */
function RollingNumber({ value, opened }: { value: string | null; opened: number }) {
  const [shown, setShown] = useState(value);
  const [leaving, setLeaving] = useState<{ value: string; up: boolean; key: number } | null>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const keyRef = useRef(0);

  useLayoutEffect(() => {
    if (value === shownRef.current) return;
    if (value === null || shownRef.current === null) {
      // The first number to arrive simply stands there.
      if (value !== null) setShown(value);
      return;
    }
    const wait = Math.max(0, SETTLE_MS - (performance.now() - opened));
    const timer = window.setTimeout(() => {
      const before = shownRef.current;
      if (before === null || before === value) return;
      keyRef.current += 1;
      setLeaving({ value: before, up: numeric(value) > numeric(before), key: keyRef.current });
      setShown(value);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [value, opened]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), 440);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const dir = leaving ? (leaving.up ? 'up' : 'down') : '';
  return (
    <span className={`td-fact-value ${dir}`}>
      {/* Holds the height (and the width of the longer of the two). */}
      <span className="td-fact-sizer" aria-hidden="true">{shown ?? '0'}</span>
      {shown !== null && (
        <span className={`td-fact-num ${leaving ? 'entering' : ''}`} key={`n${leaving?.key ?? 0}`}>
          {shown}
        </span>
      )}
      {leaving && (
        <span className="td-fact-num leaving" key={`o${leaving.key}`} aria-hidden="true">
          {leaving.value}
        </span>
      )}
    </span>
  );
}

function numeric(value: string): number {
  return Number(value.replace(/[^\d]/g, '')) || 0;
}
