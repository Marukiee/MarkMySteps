import { useEffect, useState } from 'react';
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
  const [closing, setClosing] = useState(false);
  const selected = value;
  const todayIso = toISO(new Date());

  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
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

  const monthLabel = first.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
  const headerDate = value ? fmtLong(value) : 'Kies een datum';

  return createPortal(
    <div
      className={`dp-backdrop ${closing ? 'closing' : ''}`}
      onClick={close}
      role="dialog"
      aria-modal="true"
    >
      <div className="dp-sheet card" onClick={(e) => e.stopPropagation()}>
        <div className="dp-header">
          <span className="dp-header-year">{value ? new Date(value).getFullYear() : ''}</span>
          <span className="dp-header-date">{headerDate}</span>
        </div>

        <div className="dp-nav">
          <button type="button" aria-label="Vorige maand" onClick={() => shift(-1)}>
            <Icon name="chevron-left" size={20} />
          </button>
          <span className="dp-month">{monthLabel}</span>
          <button type="button" aria-label="Volgende maand" onClick={() => shift(1)}>
            <Icon name="chevron-right" size={20} />
          </button>
        </div>

        <div className="dp-grid dp-weekdays">
          {WEEKDAYS.map((w) => (
            <span key={w} className="dp-weekday">
              {w}
            </span>
          ))}
        </div>
        <div className="dp-grid">
          {cells.map((day, i) => {
            if (day === null) return <span key={i} />;
            const iso = toISO(new Date(view.year, view.month, day));
            return (
              <button
                key={i}
                type="button"
                className={`dp-day ${iso === selected ? 'selected' : ''} ${
                  iso === todayIso ? 'today' : ''
                }`}
                onClick={() => onPick(iso)}
              >
                {day}
              </button>
            );
          })}
        </div>

        <div className="dp-actions">
          {allowClear && (
            <button
              type="button"
              className="btn btn-ghost dp-clear"
              onClick={() => onPick('')}
            >
              Wissen
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={close}>
            Annuleren
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
