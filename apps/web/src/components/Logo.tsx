/** MarkMySteps logo — a map pin whose inner shape is a footprint trail. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {/* Pin */}
      <path
        d="M16 2.5c-6 0-10.5 4.6-10.5 10.3 0 4.5 3 8.9 5.9 12.1a45 45 0 0 0 4 3.9c.4.3.9.3 1.3 0a45 45 0 0 0 4-3.9c2.8-3.2 5.8-7.6 5.8-12.1C26.5 7.1 22 2.5 16 2.5Z"
        fill="var(--accent, #e8613c)"
      />
      {/* Footsteps */}
      <ellipse cx="13" cy="10.6" rx="2.1" ry="2.9" fill="#fff" transform="rotate(-14 13 10.6)" />
      <ellipse cx="12.2" cy="14.9" rx="1.15" ry="0.85" fill="#fff" transform="rotate(-14 12.2 14.9)" />
      <ellipse cx="19.2" cy="14.4" rx="2.1" ry="2.9" fill="#fff" transform="rotate(14 19.2 14.4)" />
      <ellipse cx="20" cy="18.7" rx="1.15" ry="0.85" fill="#fff" transform="rotate(14 20 18.7)" />
    </svg>
  );
}
