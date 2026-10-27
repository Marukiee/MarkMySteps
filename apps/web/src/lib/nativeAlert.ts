import { Capacitor, registerPlugin } from '@capacitor/core';
import { t } from '../i18n';
import { isIosApp } from './native';
import { resolvedTheme } from './prefs';

interface MmsAlertPlugin {
  confirm(options: {
    title: string;
    message?: string;
    confirm: string;
    cancel: string;
    destructive: boolean;
    typeToConfirm?: string;
    tint?: string;
    dark: boolean;
  }): Promise<{ confirmed: boolean }>;
}

const MmsAlert = registerPlugin<MmsAlertPlugin>('MmsAlert');

/**
 * The iPhone asks its questions with its own alert (MmsAlertPlugin.swift).
 * Checked against the plugin, so a web bundle newer than the app around it
 * keeps the page's dialog.
 */
export function nativeAlertsAvailable(): boolean {
  return isIosApp() && Capacitor.isPluginAvailable('MmsAlert');
}

/** The same question confirmModal asks, as the system alert. */
export async function confirmNatively(options: {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  typeToConfirm?: string;
}): Promise<boolean> {
  // An alert has no bold, so the name to type is plain text there.
  const typing = options.typeToConfirm
    ? t('ui.confirm.typeToConfirm', { text: options.typeToConfirm }).replace(/<\/?b>/g, '')
    : '';
  const { confirmed } = await MmsAlert.confirm({
    title: options.title,
    message: [options.body, typing].filter(Boolean).join('\n\n') || undefined,
    confirm: options.confirmLabel ?? t('ui.confirm.confirm'),
    cancel: options.cancelLabel ?? t('common.cancel'),
    destructive: !!options.danger,
    typeToConfirm: options.typeToConfirm,
    tint: getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim(),
    dark: resolvedTheme() === 'dark',
  });
  return confirmed;
}
