import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Gesture haptics.
 *
 * Not navigator.vibrate: that is gated on user activation, which a `touchmove`
 * never grants, so a tick fired part-way through a swipe was silently dropped
 * unless something had been tapped earlier in the session. The native side goes
 * through the view's own haptic feedback, which also respects the phone's touch
 * feedback setting. The web fallback is best-effort.
 */

export type HapticStyle = 'threshold-on' | 'threshold-off' | 'end' | 'long-press' | 'light';

interface MmsHapticsPlugin {
  impact(options: { style: HapticStyle }): Promise<void>;
}

const MmsHaptics = registerPlugin<MmsHapticsPlugin>('MmsHaptics');

const WEB_MS: Record<HapticStyle, number> = {
  'threshold-on': 14,
  'threshold-off': 8,
  end: 20,
  'long-press': 18,
  light: 10,
};

export function haptic(style: HapticStyle = 'light'): void {
  if (Capacitor.isNativePlatform()) {
    void MmsHaptics.impact({ style }).catch(() => undefined);
    return;
  }
  try {
    navigator.vibrate?.(WEB_MS[style]);
  } catch {
    /* unsupported — haptics are a nicety */
  }
}
