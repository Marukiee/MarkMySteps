import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import './datepicker.css';

interface DateFieldProps {
  /** ISO date 'YYYY-MM-DD', or '' when empty. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  placeholder?: string;
  allowClear?: boolean;
}

const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

function fmtLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' });
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** A tappable field that opens a modern calendar sheet instead of the native
 *  date dialog (which renders as a dated Android/WebView popup). */
export function DateField({ value, onChange, label, id, placeholder, allowClear }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field date-field">
      {label && <label htmlFor={id}>{label}</label>}
      <button id={id} type="button" className="date-field-btn" onClick={() => setOpen(true)}>
        <Icon name="pin" size={15} className="date-field-cal" />
        <span className={value ? '' : 'date-field-empty'}>
          {value ? fmtLong(value) : placeholder ?? 'Kies een datum'}
        </span>
      </button>
      {open && (
        <CalendarSheet
          value={value}
          allowClear={allowClear}
          onClose={() => setOpen(false)}
          onPick={(iso) => {
            onChange(iso);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CalendarSheet({
  value,
  allowClear,
  onClose,
  onPick,
}: {
  value: string;
  allowClear?: boolean;
  onClose: () => void;
  onPick: (iso: string) => void;
}) {
  const base = value ? new Date(value + 'T00:00:00') : new Date();
  const [view, setView] = useState({ year: base.getFullYear(), month: base.getMonth() });
  const [picking, setPicking] = useState(false);
  // Tapping a day only stages it; "Selecteren" commits. Prevents a mis-tap from
  // silently changing the date.
  const [draft, setDraft] = useState(value);
  const yearsRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const todayIso = toISO(new Date());

  // Centre the chosen year in its strip when the panel opens.
  useEffect(() => {
    if (!picking) return;
    yearsRef.current
      ?.querySelector('.dp-year.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [picking, view.year]);

  // Animate out first, then either commit the pick or just close.
  const finish = (iso?: string) => {
    setClosing(true);
    window.setTimeout(() => (iso !== undefined ? onPick(iso) : onClose()), 190);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const first = new Date(view.year, view.month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-based
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const shift = (delta: number) =>
    setView((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });

  const monthLabel = first.toLocaleDateString('nl-NL', { month: 'long' });
  const MONTHS = [
    'jan', 'feb', 'mrt', 'apr', 'mei', 'jun',
    'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
  ];
  // A wide range, so an old trip is a scroll away rather than unreachable.
  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = 1980; y <= thisYear + 10; y++) years.push(y);

  return createPortal(
    <div
      className={`dp-backdrop ${closing ? 'closing' : ''}`}
      onClick={() => finish()}
      role="dialog"
      aria-modal="true"
    >
      <div className="dp-sheet card" onClick={(e) => e.stopPropagation()}>
        <div className="dp-header">
          <span className="dp-header-year">{draft ? new Date(draft).getFullYear() : ''}</span>
          <span className="dp-header-date">{draft ? fmtLong(draft) : 'Kies een datum'}</span>
        </div>

        <div className="dp-nav">
          <button
            type="button"
            className="dp-nav-btn"
            aria-label="Vorige maand"
            onClick={() => shift(-1)}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <button
            type="button"
            className={`dp-month ${picking ? 'open' : ''}`}
            aria-expanded={picking}
            onClick={() => setPicking((p) => !p)}
          >
            <span>
              {monthLabel} {view.year}
            </span>
            <Icon name="chevron-down" size={16} />
          </button>
          <button
            type="button"
            className="dp-nav-btn"
            aria-label="Volgende maand"
            onClick={() => shift(1)}
          >
            <Icon name="chevron-right" size={20} />
          </button>
        </div>

        <div className="dp-body">
          {picking ? (
            <div className="dp-picker" key="picker">
              <div className="dp-years" ref={yearsRef}>
                {years.map((y) => (
                  <button
                    key={y}
                    type="button"
                    className={`dp-year ${y === view.year ? 'active' : ''}`}
                    onClick={() => setView((v) => ({ ...v, year: y }))}
                  >
                    {y}
                  </button>
                ))}
              </div>
              <div className="dp-months">
                {MONTHS.map((m, i) => (
                  <button
                    key={m}
                    type="button"
                    className={`dp-month-opt ${i === view.month ? 'active' : ''}`}
                    onClick={() => {
                      setView((v) => ({ ...v, month: i }));
                      setPicking(false);
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div key="days">
              <div className="dp-grid dp-weekdays">
                {WEEKDAYS.map((w) => (
                  <span key={w} className="dp-weekday">
                    {w}
                  </span>
                ))}
              </div>
              <div className="dp-grid dp-days" key={`${view.year}-${view.month}`}>
                {cells.map((day, i) => {
                  if (day === null) return <span key={i} />;
                  const iso = toISO(new Date(view.year, view.month, day));
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`dp-day ${iso === draft ? 'selected' : ''} ${
                        iso === todayIso ? 'today' : ''
                      }`}
                      onClick={() => setDraft(iso)}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="dp-actions">
          {allowClear && (
            <button type="button" className="btn btn-ghost dp-clear" onClick={() => finish('')}>
              Wissen
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => finish()}>
            Annuleren
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!draft}
            onClick={() => finish(draft)}
          >
            Selecteren
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
