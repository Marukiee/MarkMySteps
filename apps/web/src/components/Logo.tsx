import './logo.css';

/**
 * Compact brand mark: the compass glyph from a photo-less trip cover, drawn in
 * the accent colour with no disc behind it — simpler, and it can run bigger.
 */
export function LogoMark({
  size = 30,
  spin = false,
  sweep = 0,
}: {
  size?: number;
  /** Turns forever: the waiting screen. */
  spin?: boolean;
  /** Bump this to send the needle round once and back to north. */
  sweep?: number;
}) {
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
        {/* The needle is its own element so it can turn inside the ring. */}
        {/* Keyed on `sweep` so a bump remounts the path and the animation
            starts over, however soon after the last one it comes. */}
        <path
          key={sweep}
          className={`logo-needle${spin ? ' spinning' : ''}${sweep ? ' sweeping' : ''}`}
          d="m16.4 7.6-2.5 6.3-6.3 2.5 2.5-6.3Z"
        />
      </g>
    </svg>
  );
}
