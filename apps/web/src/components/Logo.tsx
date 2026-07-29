import { Ref } from 'react';
import './logo.css';

/**
 * Compact brand mark: the compass glyph from a photo-less trip cover, drawn in
 * the accent colour with no disc behind it — simpler, and it can run bigger.
 */
export function LogoMark({
  size = 30,
  spin = false,
  needleRef,
}: {
  size?: number;
  /** Turns forever: the waiting screen. */
  spin?: boolean;
  /** Handle on the needle, for anything that wants to point it somewhere. */
  needleRef?: Ref<SVGPathElement>;
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
        <path
          ref={needleRef}
          className={`logo-needle${spin ? ' spinning' : ''}`}
          d="m16.4 7.6-2.5 6.3-6.3 2.5 2.5-6.3Z"
        />
      </g>
    </svg>
  );
}
