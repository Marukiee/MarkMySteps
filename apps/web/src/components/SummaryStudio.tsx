import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { MediaItem, RouteCollection, Trip, TripSummaryInfo } from '../api/types';
import type { PlannedStop } from '../lib/arc';
import {
  daysBetween,
  dayKey,
  defaultScope,
  lineKm,
  scopeLabel,
  scopeLines,
  suggestTemplate,
} from '../lib/summary/data';
import { renderSummary, revokePages, type RenderedPage } from '../lib/summary/render';
import {
  FORMATS,
  TEMPLATE_HINTS,
  TEMPLATE_NAMES,
  type FormatId,
  type Scope,
  type SummarySpec,
  type TemplateId,
} from '../lib/summary/types';
import { DateField } from './DatePicker';
import { Icon } from './Icon';
import './summary.css';

/**
 * Where a summary is made.
 *
 * One screen, in the order the questions actually come up: which part of the
 * trip, what it should look like, and then the thing itself, rendered for real
 * rather than sketched — what you approve is the file that gets saved.
 */
export function SummaryStudio({
  trip,
  stops,
  media,
  routes,
  onClose,
  onSaved,
}: {
  trip: Trip;
  stops: PlannedStop[];
  media: MediaItem[];
  routes: RouteCollection | null;
  onClose: () => void;
  onSaved: (summary: TripSummaryInfo) => void;
}) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 220);
  };

  const tripStart = dayKey(trip.startDate);
  const tripEnd = dayKey(trip.endDate);
  const [scope, setScope] = useState<Scope>(() => defaultScope(trip, media));
  const [template, setTemplate] = useState<TemplateId>('route');
  const [touchedTemplate, setTouchedTemplate] = useState(false);
  const [format, setFormat] = useState<FormatId>('story');
  const [series, setSeries] = useState(false);
  const [showLogo, setShowLogo] = useState(true);
  const [showWeather, setShowWeather] = useState(true);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);

  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const renderToken = useRef(0);

  const spec: SummarySpec = useMemo(
    () => ({ template, format, scope, series, showLogo, showWeather, photoIds: [] }),
    [template, format, scope, series, showLogo, showWeather],
  );

  const label = scopeLabel(scope);
  const effectiveTitle = title.trim() || `${trip.title} · ${label}`;

  // How much this slice of trip contains, which is also what decides the
  // suggested layout.
  const [km, setKm] = useState(0);
  useEffect(() => {
    let alive = true;
    void scopeLines({ trip, stops, media, routes }, scope).then((lines) => {
      if (alive) setKm(lineKm(lines));
    });
    return () => {
      alive = false;
    };
    // Only the period moves; the trip's own data is fixed while this is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const scopeFacts = useMemo(() => {
    const photos = media.filter((m) => {
      const day = dayKey(m.takenAt);
      return day >= scope.from && day <= scope.to && m.assetType === 'IMAGE';
    }).length;
    const inScope = stops.filter((s) => {
      if (s.latitude === null || s.longitude === null) return false;
      return dayKey(s.arrivalDate) <= scope.to && dayKey(s.departureDate) >= scope.from;
    }).length;
    return { photos, stops: inScope, km, days: daysBetween(scope.from, scope.to).length };
  }, [media, stops, scope, km]);

  // The layout follows the data until you disagree with it once.
  useEffect(() => {
    if (touchedTemplate) return;
    setTemplate(suggestTemplate(scope, scopeFacts.km, scopeFacts.photos, scopeFacts.stops));
  }, [scope, scopeFacts, touchedTemplate]);

  // A series only means something over more than one day.
  useEffect(() => {
    if (scopeFacts.days < 2 && series) setSeries(false);
  }, [scopeFacts.days, series]);

  // Render on every change, one at a time, throwing away anything a newer
  // change has overtaken.
  useEffect(() => {
    const token = ++renderToken.current;
    setBusy(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void renderSummary({ trip, stops, media, routes }, spec, (done, total) => {
        if (renderToken.current === token) setProgress({ done, total });
      })
        .then((result) => {
          if (renderToken.current !== token) {
            revokePages(result.pages);
            return;
          }
          setPages((old) => {
            revokePages(old);
            return result.pages;
          });
        })
        .catch((err: unknown) => {
          if (renderToken.current !== token) return;
          setError(err instanceof Error ? err.message : 'Renderen mislukt');
        })
        .finally(() => {
          if (renderToken.current === token) {
            setBusy(false);
            setProgress(null);
          }
        });
    }, 260);
    return () => window.clearTimeout(timer);
    // `spec` is the whole of the input; trip data does not change while this
    // sheet is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  useEffect(() => () => revokePages(pages), [pages]);

  async function save() {
    if (pages.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      pages.forEach((page, i) => form.append('pages', page.blob, `pagina-${i + 1}.jpg`));
      form.append('title', effectiveTitle);
      form.append('template', series ? 'series' : template);
      form.append('scopeLabel', label);
      form.append('spec', JSON.stringify(spec));
      form.append('widths', pages.map((p) => p.width).join(','));
      form.append('heights', pages.map((p) => p.height).join(','));
      const saved = await api<TripSummaryInfo>(`/trips/${trip.id}/summaries`, {
        method: 'POST',
        formData: form,
      });
      onSaved(saved);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opslaan mislukt');
    } finally {
      setSaving(false);
    }
  }

  const scopes: { kind: Scope['kind']; label: string }[] = [
    { kind: 'trip', label: 'Hele reis' },
    { kind: 'day', label: 'Eén dag' },
    { kind: 'range', label: 'Periode' },
  ];

  return createPortal(
    <div className={`summary-studio-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <div className="summary-studio card" onClick={(e) => e.stopPropagation()}>
        <div className="summary-studio-head">
          <h2>Samenvatting maken</h2>
          <button className="people-sheet-close" aria-label="Sluiten" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="summary-preview">
          {pages.length === 0 && !busy && <p className="muted">Nog niets om te tonen.</p>}
          <div className="summary-preview-strip" data-single={pages.length === 1}>
            {pages.map((page, i) => (
              <figure key={page.url} className="summary-preview-page">
                <img src={page.url} alt={`Pagina ${i + 1}`} />
                {pages.length > 1 && <figcaption>{i + 1}</figcaption>}
              </figure>
            ))}
          </div>
          {busy && (
            <div className="summary-preview-busy">
              <span className="summary-spinner" aria-hidden="true" />
              {progress ? `Pagina ${progress.done} van ${progress.total}…` : 'Tekenen…'}
            </div>
          )}
        </div>

        <section className="summary-field">
          <label>Welk deel</label>
          <div className="summary-pills">
            {scopes.map((s) => (
              <button
                key={s.kind}
                type="button"
                className={scope.kind === s.kind ? 'active' : ''}
                onClick={() => {
                  if (s.kind === 'trip') setScope({ kind: 'trip', from: tripStart, to: tripEnd });
                  else if (s.kind === 'day') {
                    const day = scope.kind === 'day' ? scope.from : defaultScope(trip, media).from;
                    setScope({ kind: 'day', from: day, to: day });
                  } else {
                    setScope({ kind: 'range', from: scope.from, to: scope.to });
                  }
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          {scope.kind === 'day' && (
            <DateField
              value={scope.from}
              onChange={(value) => setScope({ kind: 'day', from: value, to: value })}
              label="Dag"
              nearDate={tripStart}
            />
          )}
          {scope.kind === 'range' && (
            <div className="summary-range">
              <DateField
                value={scope.from}
                onChange={(value) => setScope({ ...scope, from: value, to: value > scope.to ? value : scope.to })}
                label="Van"
                nearDate={tripStart}
              />
              <DateField
                value={scope.to}
                onChange={(value) => setScope({ ...scope, to: value < scope.from ? scope.from : value })}
                label="Tot en met"
                nearDate={scope.from}
              />
            </div>
          )}
          <span className="muted summary-note">
            {scopeFacts.photos} foto{scopeFacts.photos === 1 ? '' : "'s"}
            {scopeFacts.stops > 0 && `, ${scopeFacts.stops} stop${scopeFacts.stops === 1 ? '' : 's'}`}
            {scopeFacts.days > 1 && `, ${scopeFacts.days} dagen`}
          </span>
        </section>

        <section className="summary-field">
          <label>Uiterlijk</label>
          <div className="summary-templates">
            {(Object.keys(TEMPLATE_NAMES) as TemplateId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`summary-template ${template === id ? 'active' : ''}`}
                onClick={() => {
                  setTemplate(id);
                  setTouchedTemplate(true);
                }}
              >
                <strong>{TEMPLATE_NAMES[id]}</strong>
                <span>{TEMPLATE_HINTS[id]}</span>
              </button>
            ))}
          </div>
          {!touchedTemplate && (
            <span className="muted summary-note">Voorgesteld op basis van deze dagen.</span>
          )}
        </section>

        <section className="summary-field">
          <label>Formaat</label>
          <div className="summary-pills">
            {(Object.keys(FORMATS) as FormatId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={format === id ? 'active' : ''}
                onClick={() => setFormat(id)}
              >
                {FORMATS[id].label}
              </button>
            ))}
          </div>
        </section>

        {scopeFacts.days > 1 && (
          <label className="summary-toggle">
            <div>
              <strong>Reeks van meerdere afbeeldingen</strong>
              <span className="muted">
                Een omslag met de hele route, dan een pagina per dag met foto’s, en de cijfers als
                slot. Maximaal tien dagen.
              </span>
            </div>
            <input type="checkbox" checked={series} onChange={(e) => setSeries(e.target.checked)} />
          </label>
        )}

        <label className="summary-toggle">
          <div>
            <strong>Logo tonen</strong>
            <span className="muted">Het kompas en de naam, klein linksboven.</span>
          </div>
          <input type="checkbox" checked={showLogo} onChange={(e) => setShowLogo(e.target.checked)} />
        </label>

        <label className="summary-toggle">
          <div>
            <strong>Weer tonen</strong>
            <span className="muted">
              Het echte weer van die dag op de plek waar je was. Staat er niet bij als we het niet
              zeker weten.
            </span>
          </div>
          <input
            type="checkbox"
            checked={showWeather}
            onChange={(e) => setShowWeather(e.target.checked)}
          />
        </label>

        <section className="summary-field">
          <label htmlFor="summary-title">Naam</label>
          <input
            id="summary-title"
            value={titleTouched ? title : effectiveTitle}
            onChange={(e) => {
              setTitleTouched(true);
              setTitle(e.target.value);
            }}
            placeholder={`${trip.title} · ${label}`}
          />
        </section>

        {error && <p className="error-text">{error}</p>}

        <div className="summary-studio-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Annuleren
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || saving || pages.length === 0}
            onClick={() => void save()}
          >
            <Icon name="check" size={16} />
            {saving ? 'Opslaan…' : pages.length > 1 ? `${pages.length} pagina’s bewaren` : 'Bewaren'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
