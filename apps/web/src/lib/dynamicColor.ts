/**
 * Material 3 colour roles, published to CSS as `--m3-*` custom properties.
 *
 * Two sources, one output. On Android 12+ the ramps come from the
 * wallpaper-derived system palette (MmsDynamicColor, plain AOSP resources — no
 * Play Services, so LineageOS and GrapheneOS included). Everywhere else — the
 * browser, the PWA, older phones — they are generated from the app's own coral
 * seed, so the M3 skin looks deliberate rather than broken.
 *
 * Only the M3 skin reads these. The original skin never touches them, which is
 * what keeps `data-skin="classic"` a pixel-for-pixel escape hatch.
 */
import { Hct, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** The app's own accent, used when there is no system palette to read. */
const SEED = '#e8613c';

interface DynamicColorPlugin {
  getPalette(): Promise<{ available: boolean; ramps?: Record<string, Record<string, string>> }>;
}

const Native = registerPlugin<DynamicColorPlugin>('MmsDynamicColor');

/** The five Material tonal ramps, each able to produce any tone 0–100. */
interface Ramps {
  a1: TonalPalette;
  a2: TonalPalette;
  a3: TonalPalette;
  n1: TonalPalette;
  n2: TonalPalette;
}

/**
 * AOSP publishes thirteen fixed steps per ramp, but the M3 roles need tones it
 * does not ship (94, 17, 6 …). Rather than interpolate between hexes, each ramp
 * is rebuilt as a continuous tonal palette from the hue and chroma of one
 * sample — which is how the ramp was generated in the first place, so the
 * reconstruction lands on the same colours and can answer for any tone.
 *
 * AOSP step N is Material tone (100 − N/10): `accent1_600` is tone 40.
 */
function rampFromMonet(steps: Record<string, string> | undefined, sampleStep: string): TonalPalette | null {
  const hex = steps?.[sampleStep];
  if (!hex) return null;
  const hct = Hct.fromInt(argbFromHex(hex));
  return TonalPalette.fromHueAndChroma(hct.hue, hct.chroma);
}

function monetRamps(ramps: Record<string, Record<string, string>>): Ramps | null {
  // Accents sampled at tone 40, neutrals at tone 50 — the most chromatic step
  // each ramp has, so the hue reading is not swamped by black or white.
  const a1 = rampFromMonet(ramps.accent1, '600');
  const a2 = rampFromMonet(ramps.accent2, '600');
  const a3 = rampFromMonet(ramps.accent3, '600');
  const n1 = rampFromMonet(ramps.neutral1, '500');
  const n2 = rampFromMonet(ramps.neutral2, '500');
  if (!a1 || !a2 || !a3 || !n1 || !n2) return null;
  return { a1, a2, a3, n1, n2 };
}

/**
 * The standard M3 derivation: one seed hue drives the accents, and the
 * neutrals keep a trace of it so greys sit with the accent instead of beside
 * it. Chroma values are the Material defaults.
 */
function seedRamps(seed: string): Ramps {
  const hct = Hct.fromInt(argbFromHex(seed));
  const hue = hct.hue;
  return {
    a1: TonalPalette.fromHueAndChroma(hue, Math.max(48, hct.chroma)),
    a2: TonalPalette.fromHueAndChroma(hue, 16),
    a3: TonalPalette.fromHueAndChroma(hue + 60, 24),
    n1: TonalPalette.fromHueAndChroma(hue, 4),
    n2: TonalPalette.fromHueAndChroma(hue, 8),
  };
}

/** Role → [light tone, dark tone] on the named ramp. */
type RoleMap = Record<string, [keyof Ramps, number, number]>;

const ROLES: RoleMap = {
  primary: ['a1', 40, 80],
  'on-primary': ['a1', 100, 20],
  'primary-container': ['a1', 90, 30],
  'on-primary-container': ['a1', 10, 90],
  'inverse-primary': ['a1', 80, 40],

  secondary: ['a2', 40, 80],
  'on-secondary': ['a2', 100, 20],
  'secondary-container': ['a2', 90, 30],
  'on-secondary-container': ['a2', 10, 90],

  tertiary: ['a3', 40, 80],
  'on-tertiary': ['a3', 100, 20],
  'tertiary-container': ['a3', 90, 30],
  'on-tertiary-container': ['a3', 10, 90],

  // The five-step container ladder is what gives an M3 surface its depth —
  // cards, sheets and bars sit on different rungs instead of all using one
  // "raised" colour with a shadow under it.
  surface: ['n1', 98, 6],
  'on-surface': ['n1', 10, 90],
  'surface-dim': ['n1', 87, 6],
  'surface-bright': ['n1', 98, 24],
  'surface-container-lowest': ['n1', 100, 4],
  'surface-container-low': ['n1', 96, 10],
  'surface-container': ['n1', 94, 12],
  'surface-container-high': ['n1', 92, 17],
  'surface-container-highest': ['n1', 90, 22],
  'inverse-surface': ['n1', 20, 90],
  'inverse-on-surface': ['n1', 95, 20],

  'surface-variant': ['n2', 90, 30],
  'on-surface-variant': ['n2', 30, 80],
  outline: ['n2', 50, 60],
  'outline-variant': ['n2', 80, 30],
};

/** Error is a fixed red in M3 — it must not drift with the wallpaper. */
const ERROR = TonalPalette.fromHueAndChroma(25, 84);
const ERROR_ROLES: Record<string, [number, number]> = {
  error: [40, 80],
  'on-error': [100, 20],
  'error-container': [90, 30],
  'on-error-container': [10, 90],
};

function cssVars(ramps: Ramps, dark: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [role, [ramp, light, darkTone]] of Object.entries(ROLES)) {
    out[`--m3-${role}`] = hexFromArgb(ramps[ramp].tone(dark ? darkTone : light));
  }
  for (const [role, [light, darkTone]] of Object.entries(ERROR_ROLES)) {
    out[`--m3-${role}`] = hexFromArgb(ERROR.tone(dark ? darkTone : light));
  }
  // State layers are tinted overlays in M3, not opacity changes on the element,
  // so hover/press keep the text at full contrast.
  out['--m3-scrim'] = hexFromArgb(ramps.n1.tone(0));
  return out;
}

/** Resolved once, then reused — the wallpaper cannot change under a running app. */
let cached: Ramps | null = null;

async function resolveRamps(): Promise<Ramps> {
  if (cached) return cached;
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await Native.getPalette();
      if (res.available && res.ramps) {
        const monet = monetRamps(res.ramps);
        if (monet) {
          cached = monet;
          return cached;
        }
      }
    } catch {
      // Plugin missing (older APK) — fall through to the seed.
    }
  }
  cached = seedRamps(SEED);
  return cached;
}

function paint(ramps: Ramps): void {
  const dark = document.documentElement.dataset.theme === 'dark';
  const root = document.documentElement;
  for (const [name, value] of Object.entries(cssVars(ramps, dark))) {
    root.style.setProperty(name, value);
  }
}

/**
 * Publishes the roles and keeps them in step with the light/dark flip.
 *
 * Safe to call regardless of the active skin: writing the variables costs
 * nothing while the classic skin ignores them, and it means switching skins is
 * a single attribute change with no async gap where the app is unstyled.
 */
export async function initDynamicColor(): Promise<void> {
  const ramps = await resolveRamps();
  paint(ramps);
  window.addEventListener('mms-theme', () => paint(ramps));
}
