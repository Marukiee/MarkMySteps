import { Capacitor, registerPlugin } from '@capacitor/core';
import { intlLocale, t } from '../i18n';
import { isIosApp } from './native';

interface MmsDatePlugin {
  pick(options: {
    value: string;
    near?: string;
    title?: string;
    allowClear?: boolean;
    locale: string;
    tint?: string;
    labels: { cancel: string; select: string; clear: string };
  }): Promise<{ value?: string; cancelled?: boolean }>;
}

const MmsDate = registerPlugin<MmsDatePlugin>('MmsDate');

/**
 * The iPhone picks dates on its own calendar (MmsDatePlugin.swift). Checked
 * against the plugin rather than the platform alone, so a web bundle newer
 * than the app around it keeps the page's calendar instead of opening nothing.
 */
export function nativeDatesAvailable(): boolean {
  return isIosApp() && Capacitor.isPluginAvailable('MmsDate');
}

/** The chosen day as 'YYYY-MM-DD', '' when cleared, or null when put away. */
export async function pickNativeDate(options: {
  value: string;
  near?: string;
  title?: string;
  allowClear?: boolean;
}): Promise<string | null> {
  const result = await MmsDate.pick({
    ...options,
    title: options.title ?? t('planner.date.choose'),
    locale: intlLocale(),
    tint: getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim(),
    labels: {
      cancel: t('common.cancel'),
      select: t('planner.date.select'),
      clear: t('planner.clear'),
    },
  });
  return result.cancelled ? null : (result.value ?? null);
}
