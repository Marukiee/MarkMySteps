import { useState } from 'react';
import { flagEmoji } from '../lib/colors';
import './flag.css';

/** Where a country's flag file lives. Bundled, so it works with no network. */
export function flagUrl(code?: string | null): string | null {
  const clean = code?.trim().toLowerCase();
  if (!clean || clean.length !== 2) return null;
  return `/flags/${clean}.svg`;
}

/**
 * A country's flag, as a file rather than an emoji.
 *
 * Emoji flags are drawn by whatever font the phone ships, at whatever size
 * that font decides, in a style that belongs to no app in particular — and on
 * some Android builds they are not drawn at all. These are one set, one shape,
 * one size, everywhere the app names a country. A code with no file falls back
 * to the emoji, which is better than a gap.
 */
export function Flag({
  code,
  size,
  className = '',
}: {
  code?: string | null;
  /** Left off when the caller's CSS sizes it (a marker, a thumbnail). */
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = flagUrl(code);

  if (!url || failed) {
    const emoji = flagEmoji(code);
    if (!emoji) return null;
    return (
      <span className={`flag-emoji ${className}`.trim()} style={size ? { fontSize: size } : undefined}>
        {emoji}
      </span>
    );
  }

  return (
    <img
      className={`flag ${className}`.trim()}
      src={url}
      style={size ? { width: size, height: size } : undefined}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The same flag on a MapLibre marker, which is a bare DOM node rather than
 * anything React renders. Falls back to the stop's number when there is no
 * country to show.
 */
export function paintMarker(el: HTMLElement, code: string | null | undefined, index: number): void {
  const url = flagUrl(code);
  if (!url) {
    el.textContent = flagEmoji(code) || String(index);
    return;
  }
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.className = 'stop-marker-flag';
  img.addEventListener('error', () => {
    el.textContent = flagEmoji(code) || String(index);
  });
  el.appendChild(img);
}
