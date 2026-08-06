/**
 * Optional: take the accent colour from the phone's wallpaper.
 *
 * Android derives a palette from the wallpaper and publishes it as ordinary
 * framework resources (since Android 12, plain AOSP, no Play Services), which
 * MmsDynamicColor reads. All this does with it is repoint the three accent
 * tokens; every other colour in the app stays exactly as designed. Off by
 * default, and only offered where there is a wallpaper to read.
 *
 * The tone steps line up with what the design already uses:
 *   --accent      the accent itself
 *   --accent-soft the pale wash behind it (focus glows, tinted rows)
 *   --accent-ink  the darker accent, for text on that wash
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isDynamicAccent } from './prefs';

interface DynamicColorPlugin {
  getPalette(): Promise<{ available: boolean; ramps?: Record<string, Record<string, string>> }>;
}

const Native = registerPlugin<DynamicColorPlugin>('MmsDynamicColor');

/**
 * AOSP step N is Material tone (100 - N/10), so `600` is tone 40. Light and
 * dark want opposite ends of the ramp: a mid accent on a pale wash, or a pale
 * accent on a deep one.
 */
const STEPS = {
  light: { accent: '600', soft: '100', ink: '700' },
  dark: { accent: '200', soft: '800', ink: '100' },
} as const;

/** Read once: the wallpaper cannot change under a running app. */
let ramp: Record<string, string> | null = null;
let looked = false;

async function accentRamp(): Promise<Record<string, string> | null> {
  if (looked) return ramp;
  looked = true;
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const res = await Native.getPalette();
    if (res.available && res.ramps?.accent1) ramp = res.ramps.accent1;
  } catch {
    // Older APK without the plugin: no wallpaper colours, keep the app's own.
  }
  return ramp;
}

/** True when there is actually a system palette to borrow from. */
export function dynamicAccentAvailable(): boolean {
  return ramp !== null;
}

function paint(): void {
  const root = document.documentElement;
  const tokens = ['--accent', '--accent-soft', '--accent-ink'];
  if (!ramp || !isDynamicAccent()) {
    for (const token of tokens) root.style.removeProperty(token);
    return;
  }
  const steps = root.dataset.theme === 'dark' ? STEPS.dark : STEPS.light;
  const values = [ramp[steps.accent], ramp[steps.soft], ramp[steps.ink]];
  // A ramp missing a step would leave the accent half-swapped, which reads far
  // worse than not following the wallpaper at all.
  if (values.some((v) => !v)) return;
  tokens.forEach((token, i) => root.style.setProperty(token, values[i] as string));
}

/** Applies the current preference, and keeps it in step with the theme. */
export function applyDynamicAccent(): void {
  paint();
}

export async function initDynamicAccent(): Promise<void> {
  await accentRamp();
  paint();
  window.addEventListener('mms-theme', paint);
}
