import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { t, intlLocale } from '../i18n';
import { nativeDatesAvailable, pickNativeDate } from '../lib/nativeDate';
import { formatDateRange } from '../lib/colors';
import './datepicker.css';

interface DateFieldProps {
  /** ISO date 'YYYY-MM-DD', or '' when empty. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  id?: string;
  placeholder?: string;
  allowClear?: boolean;
  /** ISO date to open on when this field is still empty — an end date starts in
   *  the start date's month instead of today's. */
  nearDate?: string;
}

/** Short weekday names, Monday first. 1 January 2024 was a Monday. */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2024, 0, 1 + i).toLocaleDateString(intlLocale(), { weekday: 'short' }),
);

/** Short month names, January first. */
const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2024, i, 1).toLocaleDateString(intlLocale(), { month: 'short' }),
);

function fmtLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'long' });
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** A tappable field that opens a modern calendar sheet instead of the native
 *  date dialog (which renders as a dated Android/WebView popup). On the iPhone
 *  it is the system's own calendar instead, in a sheet of its own. */
export function DateField({
  value,
  onChange,
  label,
  id,
  placeholder,
  allowClear,
  nearDate,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const choose = () => {
    if (!nativeDatesAvailable()) {
      setOpen(true);
      return;
    }
    void pickNativeDate({ value, near: nearDate, title: label, allowClear })
      .then((picked) => {
        if (picked !== null) onChange(picked);
      })
      // The plugin could not show itself: the page's calendar can.
      .catch(() => setOpen(true));
  };
  return (
    <div className="field date-field">
      {label && <label htmlFor={id}>{label}</label>}
      <button id={id} type="button" className="date-field-btn" onClick={choose}>
        <Icon name="pin" size={15} className="date-field-cal" />
        <span className={value ? '' : 'date-field-empty'}>
          {value ? fmtLong(value) : placeholder ?? t('planner.date.choose')}
        </span>
      </button>
      {open && (
        <CalendarSheet
          value={value}
          nearDate={nearDate}
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
  nearDate,
  allowClear,
  onClose,
  onPick,
}: {
  value: string;
  nearDate?: string;
  allowClear?: boolean;
  onClose: () => void;
  onPick: (iso: string) => void;
}) {
  const start = value || nearDate || '';
  const base = start ? new Date(start + 'T00:00:00') : new Date();
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

  const monthLabel = first.toLocaleDateString(intlLocale(), { month: 'long' });
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
          <span className="dp-header-date">{draft ? fmtLong(draft) : t('planner.date.choose')}</span>
        </div>

        <div className="dp-nav">
          <button
            type="button"
            className="dp-nav-btn"
            aria-label={t('planner.date.prevMonth')}
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
            aria-label={t('planner.date.nextMonth')}
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
              {t('planner.clear')}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => finish()}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!draft}
            onClick={() => finish(draft)}
          >
            {t('planner.date.select')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface DateRangeFieldProps {
  /** ISO dates 'YYYY-MM-DD', or '' when not chosen yet. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  label?: string;
  id?: string;
  placeholder?: string;
}

/**
 * One field for a first and a last day, the way a booking site asks for them:
 * the calendar opens on the first day, moves on to the last by itself, and
 * the days between light up. Nothing is saved until "Selecteren".
 */
export function DateRangeField({ from, to, onChange, label, id, placeholder }: DateRangeFieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field date-field">
      {label && <label htmlFor={id}>{label}</label>}
      <button id={id} type="button" className="date-field-btn" onClick={() => setOpen(true)}>
        <Icon name="pin" size={15} className="date-field-cal" />
        <span className={from && to ? '' : 'date-field-empty'}>
          {from && to ? formatDateRange(from, to) : placeholder ?? t('planner.date.chooseRange')}
        </span>
      </button>
      {open && (
        <DateRangeSheet
          from={from}
          to={to}
          onClose={() => setOpen(false)}
          onPick={(a, b) => {
            onChange(a, b);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function fmtShortDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(intlLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The calendar for a range. `min` and `max` keep it inside a trip; with
 * `resetLabel` it has a button that hands back two empty dates ("the whole
 * trip").
 */
export function DateRangeSheet({
  from,
  to,
  min,
  max,
  resetLabel,
  onClose,
  onPick,
}: {
  from: string;
  to: string;
  min?: string;
  max?: string;
  resetLabel?: string;
  onClose: () => void;
  onPick: (from: string, to: string) => void;
}) {
  const open = from || min || '';
  const base = open ? new Date(open + 'T00:00:00') : new Date();
  const [view, setView] = useState({ year: base.getFullYear(), month: base.getMonth() });
  const [draft, setDraft] = useState({ from, to });
  // Where the mouse is while the last day is being chosen: the band follows
  // it, so you see the stay before you click. Touch has no such thing.
  const [hover, setHover] = useState('');
  const [closing, setClosing] = useState(false);
  const todayIso = toISO(new Date());
  const choosingEnd = !!draft.from && !draft.to;

  const finish = (range?: { from: string; to: string }) => {
    setClosing(true);
    window.setTimeout(() => (range ? onPick(range.from, range.to) : onClose()), 190);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First tap is the first day; the next one is the last, unless it is
  // earlier, then it is a new first day. A tap once both are set starts over.
  const pick = (iso: string) =>
    setDraft((d) => (!d.from || d.to || iso < d.from ? { from: iso, to: '' } : { from: d.from, to: iso }));

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

  const lo = draft.from;
  const hi = draft.to || (choosingEnd && hover > draft.from ? hover : '');
  const count =
    draft.from && draft.to
      ? Math.round((Date.parse(draft.to) - Date.parse(draft.from)) / 86_400_000) + 1
      : 0;

  return createPortal(
    <div
      className={`dp-backdrop ${closing ? 'closing' : ''}`}
      onClick={() => finish()}
      role="dialog"
      aria-modal="true"
    >
      <div className="dp-sheet dp-range card" onClick={(e) => e.stopPropagation()}>
        <div className="dp-header">
          <div className="dp-range-ends">
            <button
              type="button"
              className={`dp-range-end ${choosingEnd ? '' : 'active'}`}
              onClick={() => setDraft({ from: '', to: '' })}
            >
              <span>{t('planner.date.start')}</span>
              <strong>{draft.from ? fmtShortDay(draft.from) : '…'}</strong>
            </button>
            <Icon name="chevron-right" size={18} className="dp-range-arrow" />
            <button
              type="button"
              className={`dp-range-end ${choosingEnd ? 'active' : ''}`}
              disabled={!draft.from}
              onClick={() => setDraft((d) => ({ from: d.from, to: '' }))}
            >
              <span>{t('planner.date.end')}</span>
              <strong>{draft.to ? fmtShortDay(draft.to) : '…'}</strong>
            </button>
          </div>
          <span className="dp-header-year" aria-live="polite">
            {count
              ? t('common.days', { count })
              : choosingEnd
                ? t('planner.date.chooseEnd')
                : t('planner.date.chooseStart')}
          </span>
        </div>

        <div className="dp-nav">
          <button
            type="button"
            className="dp-nav-btn"
            aria-label={t('planner.date.prevMonth')}
            onClick={() => shift(-1)}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <span className="dp-month dp-month-static">
            {first.toLocaleDateString(intlLocale(), { month: 'long' })} {view.year}
          </span>
          <button
            type="button"
            className="dp-nav-btn"
            aria-label={t('planner.date.nextMonth')}
            onClick={() => shift(1)}
          >
            <Icon name="chevron-right" size={20} />
          </button>
        </div>

        <div className="dp-body">
          <div className="dp-grid dp-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w} className="dp-weekday">
                {w}
              </span>
            ))}
          </div>
          <div
            className="dp-grid dp-days"
            key={`${view.year}-${view.month}`}
            onPointerLeave={() => setHover('')}
          >
            {cells.map((day, i) => {
              if (day === null) return <span key={i} />;
              const iso = toISO(new Date(view.year, view.month, day));
              const isStart = iso === lo;
              const isEnd = !!hi && iso === hi;
              const between = !!hi && iso > lo && iso < hi;
              const outside = (!!min && iso < min) || (!!max && iso > max);
              return (
                <span
                  key={i}
                  className={`dp-cell ${between ? 'in-range' : ''} ${isStart && hi && hi !== lo ? 'range-start' : ''} ${
                    isEnd && hi !== lo ? 'range-end' : ''
                  }`}
                >
                  <button
                    type="button"
                    className={`dp-day ${isStart || isEnd ? 'selected' : ''} ${iso === todayIso ? 'today' : ''}`}
                    disabled={outside}
                    onClick={() => pick(iso)}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(iso)}
                  >
                    {day}
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        <div className="dp-actions">
          {resetLabel && (
            <button type="button" className="btn btn-ghost dp-clear" onClick={() => finish({ from: '', to: '' })}>
              {resetLabel}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => finish()}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!draft.from || !draft.to}
            onClick={() => finish(draft)}
          >
            {t('planner.date.select')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
