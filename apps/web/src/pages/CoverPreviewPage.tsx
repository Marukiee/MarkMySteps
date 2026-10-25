import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { tripCoverBg } from '../lib/colors';
import { t } from '../i18n';
import {
  TRIP_GLYPH_RULES,
  tripGlyph,
  tripGlyphSize,
  tripGlyphStroke,
} from '../lib/tripGlyph';
import './coverpreview.css';

/**
 * What a trip without a photo looks like (developer options).
 *
 * One card per rule in lib/tripGlyph, plus a box to try a name of your own —
 * the rules are matched on words, so seeing "Zomer in Zwitserland" fall back
 * to the compass is as useful as seeing "Interrail" find its train.
 */
export function CoverPreviewPage() {
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');

  // One example per rule, in the order the rules are tried, then a name that
  // matches nothing so the fallback is on the page too.
  const samples = [
    ...TRIP_GLYPH_RULES.map((rule) => sampleFor(rule.words[0]!)),
    t('trips.coverPreview.fallbackSample'),
  ];

  return (
    <main className="page fade-in cover-preview">
      <button type="button" className="cp-back" onClick={() => navigate('/settings')}>
        <Icon name="arrow-left" size={17} /> {t('common.back')}
      </button>

      <h1>{t('trips.coverPreview.title')}</h1>
      <p className="muted cp-intro">{t('trips.coverPreview.intro')}</p>

      <div className="field cp-try">
        <label htmlFor="cp-name">{t('trips.coverPreview.try')}</label>
        <input
          id="cp-name"
          value={typed}
          placeholder={t('trips.coverPreview.placeholder')}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>

      <div className="cp-grid">
        {typed.trim() && <CoverCard name={typed.trim()} />}
        {samples.map((name) => (
          <CoverCard key={name} name={name} />
        ))}
      </div>
    </main>
  );
}

function CoverCard({ name }: { name: string }) {
  return (
    <span className="cp-cover" style={{ background: tripCoverBg({ id: name }) }}>
      <span className="cp-cover-glyph" data-glyph={tripGlyph(name)} aria-hidden="true">
        <Icon
          name={tripGlyph(name)}
          size={tripGlyphSize(name, 86)}
          strokeWidth={tripGlyphStroke(name)}
        />
      </span>
      <span className="cp-cover-name">{name}</span>
    </span>
  );
}

/** A plausible trip name built around a keyword, so the cards read as trips. */
function sampleFor(word: string): string {
  const first = word.charAt(0).toUpperCase() + word.slice(1);
  return `${first} 2026`;
}
