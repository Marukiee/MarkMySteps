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
    pending?: boolean;
    tint?: string;
    dark: boolean;
  }): Promise<{ id?: string }>;
  fill(options: { items: NativeMenuItem[] }): Promise<void>;
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
 * Opens the system menu from `from`, the pill that was tapped or the point a
 * finger held, in groups with a line between them. The picked id, or null when
 * the menu was put away. Rejects on an iOS too old to open a menu by itself;
 * the page's own menu is the way out then.
 *
 * With `pending` the menu ends in a loading row until fillNativeMenu says
 * what goes there.
 */
export async function showNativeMenu(
  from: Element | { x: number; y: number },
  sections: NativeMenuItem[][],
  title?: string,
  pending?: boolean,
): Promise<string | null> {
  const r = 'getBoundingClientRect' in from
    ? from.getBoundingClientRect()
    : { left: from.x, top: from.y, width: 1, height: 1 };
  const { id } = await MmsMenu.show({
    x: r.left,
    y: r.top,
    width: r.width,
    height: r.height,
    title,
    sections,
    pending,
    tint: getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim(),
    dark: resolvedTheme() === 'dark',
  });
  return id ?? null;
}

/** What goes where the open menu's loading row is; nothing takes it away. */
export function fillNativeMenu(items: NativeMenuItem[]): void {
  void MmsMenu.fill({ items }).catch(() => undefined);
}
