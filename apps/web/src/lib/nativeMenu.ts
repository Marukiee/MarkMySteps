import { Capacitor, registerPlugin } from '@capacitor/core';
import { isIosApp } from './native';
import { resolvedTheme } from './prefs';

export interface NativeMenuItem {
  id: string;
  title: string;
  /** A second, smaller line under the title. */
  subtitle?: string;
  /** An SF Symbol name. */
  symbol?: string;
  /** Ticked: what is chosen now. */
  checked?: boolean;
  destructive?: boolean;
}

interface MmsMenuPlugin {
  show(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    sections: NativeMenuItem[][];
    tint?: string;
    dark: boolean;
  }): Promise<{ id?: string }>;
}

const MmsMenu = registerPlugin<MmsMenuPlugin>('MmsMenu');

/**
 * The iPhone opens its pull-down menus as its own (MmsMenuPlugin.swift).
 * Checked against the plugin, so a web bundle newer than the app around it
 * keeps the page's menus.
 */
export function nativeMenusAvailable(): boolean {
  return isIosApp() && Capacitor.isPluginAvailable('MmsMenu');
}

/**
 * Opens the system menu from `from`, the pill that was tapped, in groups with
 * a line between them. The picked id, or null when the menu was put away.
 * Rejects on an iOS too old to open a menu by itself; the page's own menu is
 * the way out then.
 */
export async function showNativeMenu(
  from: Element,
  sections: NativeMenuItem[][],
  title?: string,
): Promise<string | null> {
  const r = from.getBoundingClientRect();
  const { id } = await MmsMenu.show({
    x: r.left,
    y: r.top,
    width: r.width,
    height: r.height,
    title,
    sections,
    tint: getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim(),
    dark: resolvedTheme() === 'dark',
  });
  return id ?? null;
}
