import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isIosApp } from './native';

/** One photo as the native viewer gets it: where its pixels are, and its shape. */
export interface NativeViewerItem {
  id: string;
  video: boolean;
  /** Full addresses the viewer fetches itself, with the token it was given. */
  low?: string;
  full?: string;
  /** The same two as API paths, for asking the page when that fails. */
  lowPath?: string;
  fullPath?: string;
  /** A photo that never left the phone: its Photos asset id. */
  asset?: string;
  ratio?: number;
}

export interface NativeViewerState {
  id: string;
  title: string;
  subtitle?: string;
  actions: { id: string; title: string; symbol: string }[];
  comments?: {
    title: string;
    button: string;
    list: {
      id: string;
      name: string;
      traveller: boolean;
      time: string;
      body: string;
      canDelete: boolean;
      likes: number;
      liked: boolean;
      likedBy: string;
    }[];
  };
  reactions?: { mine: string | null; total: number; names: string };
  /** The page's current token, which may have been refreshed since `open`. */
  token?: string;
}

export interface NativeViewerLabels {
  close: string;
  more: string;
  comments: string;
  commentsClose: string;
  placeholder: string;
  post: string;
  delete: string;
  empty: string;
  traveller: string;
  videoLoading: string;
  like: string;
  unlike: string;
  change: string;
  reactions: { kind: string; emoji: string; label: string }[];
}

interface MmsViewerPlugin {
  open(options: {
    items: NativeViewerItem[];
    index: number;
    labels: NativeViewerLabels;
    startWithComments: boolean;
    token?: string;
  }): Promise<void>;
  items(options: { items: NativeViewerItem[]; index?: number }): Promise<void>;
  state(options: NativeViewerState): Promise<void>;
  image(options: { key: string; base64?: string; token?: string }): Promise<void>;
  video(options: { id: string; url?: string }): Promise<void>;
  note(options: { text?: string; busy: boolean }): Promise<void>;
  result(options: { request: string; error?: string }): Promise<void>;
  share(options: { files: string[] }): Promise<{ completed: boolean }>;
  close(): Promise<void>;
  addListener(event: 'index', fn: (e: { index: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'closed', fn: () => void): Promise<PluginListenerHandle>;
  addListener(event: 'action', fn: (e: { action: string; id: string }) => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'react',
    fn: (e: { target: string; kind: string | null }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'post',
    fn: (e: { id: string; body: string; request: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'remove',
    fn: (e: { comment: string; request: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'video', fn: (e: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'image', fn: (e: { key: string; path: string }) => void): Promise<PluginListenerHandle>;
}

export const MmsViewer = registerPlugin<MmsViewerPlugin>('MmsViewer');

/**
 * The iPhone draws the photo viewer itself. Checked against the plugin rather
 * than the platform alone, so a web bundle newer than the app around it falls
 * back to the viewer on the page instead of opening nothing.
 */
export function nativeViewerAvailable(): boolean {
  return isIosApp() && Capacitor.isPluginAvailable('MmsViewer');
}

let open = false;

/** Whether the native viewer is on screen, covering the page. */
export function nativeViewerOpen(): boolean {
  return open;
}

export function setNativeViewerOpen(value: boolean): void {
  open = value;
}
