import { Fragment, ReactNode } from 'react';
import { TKey, TVars, t } from '.';

/** What each tag in a text turns into: `{ b: (s) => <b>{s}</b> }`. */
export type RichTags = Record<string, (chunk: ReactNode) => ReactNode>;

/**
 * Text with a bit of markup in it, for a sentence that has a link or a bold
 * word in the middle.
 *
 * The words stay one sentence in the dictionary (`Zet hem op <b>Altijd
 * toestaan</b> om ...`), because a translation needs the whole of it, and the
 * word order around the bold part is not the same in every language. Tags are
 * plain `<name>...</name>`, not nested; a tag without an entry in `tags` is
 * left as its inner text. Placeholders are filled in after the tags are found,
 * so a trip called `<b>` stays a trip called `<b>`.
 */
export function tr(key: TKey, tags: RichTags, vars?: TVars): ReactNode {
  return rich(t(key, vars ? shield(vars) : undefined), tags);
}

const OPEN = '\u0001';
const CLOSE = '\u0002';

/** Angle brackets in the values become stand-ins, so they cannot be read as tags. */
function shield(vars: TVars): TVars {
  const out: TVars = {};
  for (const [name, value] of Object.entries(vars)) {
    out[name] =
      typeof value === 'string' ? value.replaceAll('<', OPEN).replaceAll('>', CLOSE) : value;
  }
  return out;
}

function unshield(text: string): string {
  return text.replaceAll(OPEN, '<').replaceAll(CLOSE, '>');
}

function rich(text: string, tags: RichTags): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const [whole, name, inner] = match as unknown as [string, string, string];
    if (match.index > last) parts.push(unshield(text.slice(last, match.index)));
    const wrap = tags[name];
    parts.push(
      <Fragment key={parts.length}>{wrap ? wrap(unshield(inner)) : unshield(inner)}</Fragment>,
    );
    last = match.index + whole.length;
  }
  if (last < text.length) parts.push(unshield(text.slice(last)));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
