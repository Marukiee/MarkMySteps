/**
 * Compact brand mark: the compass glyph from a photo-less trip cover, drawn in
 * the accent colour with no disc behind it — simpler, and it can run bigger.
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <g
        stroke="var(--accent, #e8613c)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <circle cx="12" cy="12" r="9.4" />
        <path d="m16.4 7.6-2.5 6.3-6.3 2.5 2.5-6.3Z" />
      </g>
    </svg>
  );
}
