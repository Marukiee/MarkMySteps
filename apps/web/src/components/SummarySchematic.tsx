import type { TemplateId } from '../lib/summary/types';

/**
 * What a layout is, in the abstract.
 *
 * Not a rendering of your own poster: a diagram of where things land. A real
 * miniature carried the trip's photos and colours and colours are exactly what
 * you are not choosing here — you are choosing whether the map, the pictures or
 * the figures get the room. So: bars for text, blocks for photographs, a frame
 * for the map, and nothing else.
 */
export function SummarySchematic({ template }: { template: TemplateId }) {
  return (
    <svg viewBox="0 0 108 192" className="summary-schematic" aria-hidden="true">
      {template === 'route' && <RouteShape />}
      {template === 'photos' && <PhotosShape />}
      {template === 'ribbon' && <RibbonShape />}
      {template === 'stats' && <StatsShape />}
    </svg>
  );
}

/** Mark, date, name, and the row of figures every layout opens with. */
function Head({ facts = true }: { facts?: boolean }) {
  return (
    <>
      <circle cx="14" cy="14" r="4" className="s-line" />
      <rect x="21" y="12" width="26" height="4" rx="2" className="s-line" />
      <rect x="72" y="12" width="24" height="4" rx="2" className="s-faint" />
      <rect x="10" y="26" width="70" height="9" rx="3" className="s-ink" />
      <rect x="10" y="38" width="44" height="9" rx="3" className="s-ink" />
      {facts && (
        <>
          {[10, 33, 56, 79].map((x) => (
            <g key={x}>
              <rect x={x} y="54" width="15" height="7" rx="2" className="s-ink" />
              <rect x={x} y="64" width="11" height="3" rx="1.5" className="s-faint" />
            </g>
          ))}
        </>
      )}
    </>
  );
}

function RouteShape() {
  return (
    <>
      <Head />
      <rect x="10" y="76" width="88" height="76" rx="6" className="s-panel" />
      {/* The names, listed in the corner of the map. */}
      <rect x="16" y="82" width="34" height="26" rx="4" className="s-card" />
      {[86, 94, 102].map((y) => (
        <rect key={y} x="20" y={y} width="24" height="3" rx="1.5" className="s-faint" />
      ))}
      <path d="M24 140 L44 128 L58 132 L74 112 L86 104" className="s-route" />
      <circle cx="44" cy="128" r="3" className="s-dot" />
      <circle cx="74" cy="112" r="3" className="s-dot" />
      {[10, 41, 72].map((x) => (
        <rect key={x} x={x} y="158" width="26" height="24" rx="4" className="s-block" />
      ))}
    </>
  );
}

function PhotosShape() {
  return (
    <>
      {[0, 1, 2].map((row) =>
        [0, 1].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={col * 55}
            y={row * 65}
            width="53"
            height="63"
            className="s-block"
          />
        )),
      )}
      <rect x="0" y="128" width="108" height="64" className="s-veil" />
      <circle cx="14" cy="14" r="4" className="s-onphoto" />
      <rect x="21" y="12" width="26" height="4" rx="2" className="s-onphoto" />
      <rect x="10" y="150" width="76" height="10" rx="3" className="s-onphoto" />
      <rect x="10" y="164" width="46" height="6" rx="3" className="s-onphoto-soft" />
      <rect x="10" y="175" width="22" height="8" rx="4" className="s-onphoto-soft" />
    </>
  );
}

function RibbonShape() {
  return (
    <>
      <Head />
      <rect x="10" y="76" width="88" height="66" rx="6" className="s-panel" />
      <path d="M22 130 L38 118 L52 122 L66 104 L82 92" className="s-route" />
      {[
        [22, 130],
        [38, 118],
        [66, 104],
        [82, 92],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3" className="s-dot" />
      ))}
      {[10, 33, 56, 79].map((x) => (
        <g key={x}>
          <rect x={x} y="150" width="19" height="19" rx="3" className="s-block" />
          <rect x={x} y="173" width="15" height="3" rx="1.5" className="s-faint" />
        </g>
      ))}
    </>
  );
}

function StatsShape() {
  return (
    <>
      <rect x="0" y="0" width="108" height="192" className="s-block" />
      <rect x="0" y="60" width="108" height="132" className="s-veil" />
      <circle cx="14" cy="14" r="4" className="s-onphoto" />
      <rect x="21" y="12" width="26" height="4" rx="2" className="s-onphoto" />
      <path d="M24 40 L40 30 L54 34 L70 20" className="s-route" />
      <rect x="10" y="118" width="72" height="10" rx="3" className="s-onphoto" />
      {[
        [10, 138],
        [58, 138],
        [10, 160],
        [58, 160],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="26" height="10" rx="3" className="s-onphoto" />
          <rect x={x} y={y! + 13} width="16" height="3" rx="1.5" className="s-onphoto-soft" />
        </g>
      ))}
    </>
  );
}
