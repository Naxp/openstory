/**
 * Detects an active `@`-mention immediately to the left of the caret.
 *
 * Triggers only when `@` is preceded by start-of-string or whitespace so
 * email addresses (`user@host`) don't open the autocomplete.
 */
export type MentionTrigger = {
  /** Index of the `@` character in `text`. */
  atIndex: number;
  /** Text typed after `@`, up to the caret. */
  query: string;
};

export function detectMentionTrigger(
  text: string,
  caret: number
): MentionTrigger | null {
  if (caret < 1 || caret > text.length) return null;

  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') {
      const prev = i === 0 ? '' : text[i - 1];
      if (i !== 0 && prev && !/\s/.test(prev)) return null;
      return { atIndex: i, query: text.slice(i + 1, caret) };
    }
    if (ch === undefined) return null;
    // Allow letters, digits, hyphen, underscore, colon (tags contain these).
    // Any other char (including whitespace) closes the trigger window.
    if (!/[A-Za-z0-9_\-:]/.test(ch)) return null;
  }
  return null;
}

/**
 * Replaces the active `@query` span (from `atIndex` through `caret`) with
 * the canonical tag plus a trailing space. The caret is positioned after
 * the inserted tag + space.
 */
export type InsertMentionResult = {
  text: string;
  caret: number;
};

export function insertMention(
  text: string,
  trigger: MentionTrigger,
  caret: number,
  tag: string
): InsertMentionResult {
  const before = text.slice(0, trigger.atIndex);
  const after = text.slice(caret);
  const insert = `${tag} `;
  return {
    text: `${before}${insert}${after}`,
    caret: before.length + insert.length,
  };
}
