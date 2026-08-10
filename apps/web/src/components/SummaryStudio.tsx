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
  photoSlots,
  scopeLabel,
  scopeLines,
  suggestTemplate,
} from '../lib/summary/data';
import { renderSummary, revokePages, type RenderedPage } from '../lib/summary/render';
import {
  FORMATS,
  SUBTITLE_NAMES,
  TEMPLATE_HINTS,
  TEMPLATE_NAMES,
  THEME_NAMES,
  type FormatId,
  type Scope,
  type SubtitleMode,
  type SummarySpec,
  type TemplateId,
  type ThemeId,
} from '../lib/summary/types';
import { skipNextPop } from '../lib/backStack';
import { resolvedTheme } from '../lib/prefs';
import { AuthImage } from './AuthImage';
import { DateField } from './DatePicker';
import { SummaryPageViewer, SummaryPhotoSwap } from './SummaryOverlays';
import { SummarySchematic } from './SummarySchematic';
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
  initial,
  onClose,
  onSaved,
}: {
  trip: Trip;
  stops: PlannedStop[];
  media: MediaItem[];
  routes: RouteCollection | null;
  /** The recipe of a poster you opened to change. Absent for a fresh one. */
  initial?: Partial<SummarySpec> | null;
  onClose: () => void;
  onSaved: (summary: TripSummaryInfo) => void;
}) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  /** One way out, so the sheet leaves the same way however you dismissed it. */
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(onClose, 260);
  };

  /**
   * A back gesture belongs to whatever is on top.
   *
   * Without an entry of its own the swipe went straight past the maker and out
   * of the trip; this puts one on the stack so back closes the maker and
   * leaves you where you were, in mensen & delen.
   */
  useEffect(() => {
    window.history.pushState({ mmsSummaryStudio: true }, '');
    let popped = false;
    const onPop = () => {
      popped = true;
      // Down and away, the same as tapping the cross: a back gesture that made
      // the whole sheet vanish between one frame and the next read as a crash.
      close();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) {
        // Ours to consume; the sheet underneath must not read it as a gesture.
        skipNextPop();
        window.history.back();
      }
    };
    // Mounted once per visit to the maker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tripStart = dayKey(trip.startDate);
  const tripEnd = dayKey(trip.endDate);
  const [scope, setScope] = useState<Scope>(() => initial?.scope ?? defaultScope(trip, media));
  const [template, setTemplate] = useState<TemplateId>(initial?.template ?? 'route');
  // Reopening a poster means keeping the layout it had, not being talked out
  // of it by the suggestion.
  const [touchedTemplate, setTouchedTemplate] = useState(Boolean(initial?.template));
  const [format, setFormat] = useState<FormatId>(initial?.format ?? 'story');
  // Starts on whatever the app itself is wearing.
  const [theme, setTheme] = useState<ThemeId>(
    () => initial?.theme ?? (resolvedTheme() === 'light' ? 'light' : 'dark'),
  );
  const [subtitle, setSubtitle] = useState<SubtitleMode>(initial?.subtitle ?? 'auto');
  const [subtitleText, setSubtitleText] = useState(initial?.subtitleText ?? '');
  /** Photos you picked yourself; empty means "choose them for me". */
  const [photoIds, setPhotoIds] = useState<string[]>(initial?.photoIds ?? []);
  const [series, setSeries] = useState(Boolean(initial?.series));
  const [showLogo, setShowLogo] = useState(initial?.showLogo ?? true);
  const [showWeather, setShowWeather] = useState(initial?.showWeather ?? true);
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);

  /** A page opened full size, and which photo slot you tapped to change. */
  const [zoomed, setZoomed] = useState<number | null>(null);
  const [swapping, setSwapping] = useState<{ page: number; slot: number } | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const renderToken = useRef(0);

  const spec: SummarySpec = useMemo(
    () => ({
      template,
      format,
      theme,
      subtitle,
      subtitleText,
      scope,
      series,
      showLogo,
      showWeather,
      photoIds,
    }),
    [template, format, theme, subtitle, subtitleText, scope, series, showLogo, showWeather, photoIds],
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

  // A photo you picked out of Tuesday means nothing once you are looking at
  // Friday, so the choice belongs to the period it was made in.
  const firstScope = useRef(scope);
  useEffect(() => {
    if (firstScope.current === scope) return;
    setPhotoIds([]);
  }, [scope]);

  /** Every photo taken inside the period, oldest first: what you pick from. */
  const scopePhotos = useMemo(
    () =>
      media
        .filter((m) => m.assetType === 'IMAGE')
        .filter((m) => {
          const day = dayKey(m.takenAt);
          return day >= scope.from && day <= scope.to;
        })
        .sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [media, scope],
  );
  const slots = photoSlots(template);

  const scopeFacts = useMemo(() => {
    const photos = scopePhotos.length;
    const inScope = stops.filter((s) => {
      if (s.latitude === null || s.longitude === null) return false;
      return dayKey(s.arrivalDate) <= scope.to && dayKey(s.departureDate) >= scope.from;
    }).length;
    return { photos, stops: inScope, km, days: daysBetween(scope.from, scope.to).length };
  }, [scopePhotos, stops, scope, km]);

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

  // Stoppenlint is a route with places on it. One day usually has one place,
  // and a lint of one dot is not a picture — so that pairing is not offered.
  const dayAllowed = template !== 'ribbon';
  // A route map and a lint already draw the whole journey on one page; making
  // ten of them is ten copies of the same picture. Only the photo-led layouts
  // have something new to say on every page.
  const seriesAllowed = template === 'photos' || template === 'stats';
  useEffect(() => {
    if (!seriesAllowed && series) setSeries(false);
  }, [seriesAllowed, series]);
  useEffect(() => {
    if (!dayAllowed && scope.kind === 'day') {
      setScope({ kind: 'trip', from: tripStart, to: tripEnd });
    }
  }, [dayAllowed, scope.kind, tripStart, tripEnd]);

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
          <h2>
            Samenvatting maken <span className="summary-beta">(bèta)</span>
          </h2>
          <button className="people-sheet-close" aria-label="Sluiten" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="summary-preview" data-busy={busy}>
          {pages.length === 0 && !busy && <p className="muted">Nog niets om te tonen.</p>}
          <div className="summary-preview-strip" data-single={pages.length === 1}>
            {pages.map((page, i) => (
              <figure key={page.url} className="summary-preview-page">
                <img src={page.url} alt={`Pagina ${i + 1}`} />
                {/* Every photograph on the poster is a target: press the one
                    you want to be something else. The rest of the page opens
                    it full size. */}
                {page.slots.map((slot, si) => (
                  <button
                    key={si}
                    type="button"
                    className="summary-slot-hit"
                    aria-label="Andere foto kiezen"
                    style={{
                      left: `${(slot.box.x / page.width) * 100}%`,
                      top: `${(slot.box.y / page.height) * 100}%`,
                      width: `${(slot.box.w / page.width) * 100}%`,
                      height: `${(slot.box.h / page.height) * 100}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSwapping({ page: i, slot: si });
                    }}
                  >
                    <Icon name="camera" size={16} />
                  </button>
                ))}
                <button
                  type="button"
                  className="summary-preview-open"
                  aria-label={`Pagina ${i + 1} groter bekijken`}
                  onClick={() => setZoomed(i)}
                />
                {pages.length > 1 && <figcaption>{i + 1}</figcaption>}
              </figure>
            ))}
          </div>
          {/* Over the whole preview, centred, with the old poster dimmed
              underneath — a line of text pinned to the bottom edge landed
              half on top of whatever was being replaced. */}
          {busy && (
            <div className="summary-preview-busy">
              <span className="summary-spinner" aria-hidden="true" />
              <span>{progress ? `Pagina ${progress.done} van ${progress.total}…` : 'Tekenen…'}</span>
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
                disabled={s.kind === 'day' && !dayAllowed}
                title={s.kind === 'day' && !dayAllowed ? 'Een stoppenlint heeft meer dan één plaats nodig' : undefined}
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
                <span className="summary-template-shot">
                  <SummarySchematic template={id} />
                </span>
                <strong>{TEMPLATE_NAMES[id]}</strong>
                <span className="summary-template-hint">{TEMPLATE_HINTS[id]}</span>
              </button>
            ))}
          </div>
          {!touchedTemplate && (
            <span className="muted summary-note">Voorgesteld op basis van deze dagen.</span>
          )}
        </section>

        {!series && scopePhotos.length > 0 && (
          <section className="summary-field">
            <label>
              Foto’s
              <span className="summary-field-note">
                {photoIds.length > 0 ? `${photoIds.length} van ${slots} gekozen` : 'automatisch'}
              </span>
            </label>
            <div className="summary-photo-strip">
              {scopePhotos.map((item) => {
                const at = photoIds.indexOf(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`summary-photo ${at >= 0 ? 'picked' : ''}`}
                    aria-pressed={at >= 0}
                    onClick={() =>
                      setPhotoIds((list) =>
                        list.includes(item.id)
                          ? list.filter((id) => id !== item.id)
                          : // Past the last slot the oldest pick makes room,
                            // so tapping never simply does nothing.
                            [...list, item.id].slice(-slots),
                      )
                    }
                  >
                    <AuthImage path={`/media/${item.id}/thumbnail`} alt="" className="summary-photo-img" />
                    {at >= 0 && <span className="summary-photo-mark">{at + 1}</span>}
                  </button>
                );
              })}
            </div>
            {/* Folds open and shut, so the sections under it slide instead of
                jumping a button's worth. */}
            <div className="summary-fold" data-open={photoIds.length > 0}>
              <div>
                <button
                  type="button"
                  className="btn btn-ghost summary-photo-clear"
                  onClick={() => setPhotoIds([])}
                >
                  Weer automatisch kiezen
                </button>
              </div>
            </div>
          </section>
        )}

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
                {/* The shape itself, at the ratio it stands for. */}
                <span className="summary-ratio" data-format={id} aria-hidden="true" />
                {FORMATS[id].label}
              </button>
            ))}
          </div>
        </section>

        <section className="summary-field">
          <label>Thema</label>
          <div className="summary-pills">
            {(Object.keys(THEME_NAMES) as ThemeId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={theme === id ? 'active' : ''}
                onClick={() => setTheme(id)}
              >
                {THEME_NAMES[id]}
              </button>
            ))}
          </div>
        </section>

        <section className="summary-field">
          <label>Onder de titel</label>
          <div className="summary-pills">
            {(['auto', 'countries', 'place'] as SubtitleMode[]).map((id) => (
              <button
                key={id}
                type="button"
                className={!subtitleText.trim() && subtitle === id ? 'active' : ''}
                onClick={() => {
                  setSubtitle(id);
                  setSubtitleText('');
                }}
              >
                {SUBTITLE_NAMES[id]}
              </button>
            ))}
          </div>
          <div className="summary-input">
            <Icon name="pencil" size={15} />
            <input
              value={subtitleText}
              onChange={(e) => setSubtitleText(e.target.value)}
              placeholder="of typ zelf wat"
            />
            {subtitleText && (
              <button type="button" aria-label="Wissen" onClick={() => setSubtitleText('')}>
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <span className="muted summary-note">
            “Automatisch” zegt bij een hele reis in welke landen je was, en bij een dag of een
            periode waar je toen zat.
          </span>
        </section>

        {scopeFacts.days > 1 && seriesAllowed && (
          <label className="summary-toggle">
            <div>
              <strong>Reeks van meerdere afbeeldingen</strong>
              <span className="muted">
                Een omslag met de hele route, dan een pagina per stop met de foto’s van díe stop, en
                de cijfers als slot. Maximaal tien stops.
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
            <span className="muted">Het echte weer van die dag, op de plek waar je toen was.</span>
          </div>
          <input
            type="checkbox"
            checked={showWeather}
            onChange={(e) => setShowWeather(e.target.checked)}
          />
        </label>

        <section className="summary-field">
          <label htmlFor="summary-title">Naam</label>
          <div className="summary-input">
            <input
              id="summary-title"
              value={titleTouched ? title : effectiveTitle}
              onChange={(e) => {
                setTitleTouched(true);
                setTitle(e.target.value);
              }}
              placeholder={`${trip.title} · ${label}`}
            />
          </div>
        </section>

        {error && <p className="error-text">{error}</p>}

        {zoomed !== null && pages[zoomed] && (
          <SummaryPageViewer
            page={pages[zoomed]!}
            index={zoomed}
            total={pages.length}
            onClose={() => setZoomed(null)}
          />
        )}

        {swapping && (
          <SummaryPhotoSwap
            photos={scopePhotos}
            current={pages[swapping.page]?.slots[swapping.slot]?.id ?? null}
            onClose={() => setSwapping(null)}
            onPick={(id) => {
              const page = pages[swapping.page];
              if (page) {
                // Automatic until now: take what was chosen for you as the
                // starting point, then put this one in the slot you tapped.
                const base =
                  photoIds.length > 0
                    ? [...photoIds]
                    : page.slots.map((s) => s.id).filter((s): s is string => s !== null);
                const at = Math.min(swapping.slot, base.length);
                base[at] = id;
                setPhotoIds(base.slice(0, slots));
              }
              setSwapping(null);
            }}
          />
        )}

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
