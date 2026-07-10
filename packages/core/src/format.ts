/**
 * LinkedIn has no rich text in post bodies — "bold"/"italic" are faked with
 * Unicode Mathematical Alphanumeric glyphs (𝗯𝗼𝗹𝗱, 𝘪𝘵𝘢𝘭𝘪𝘤). These render as
 * styled text everywhere (LinkedIn, X, WhatsApp), so a draft can carry real
 * emphasis through copy-paste. This module converts ASCII ⇄ those glyphs.
 *
 * We use the Sans-Serif variants — they read cleanest in a feed:
 *   bold        𝗔–𝗭 U+1D5D4 · 𝗮–𝘇 U+1D5EE · 𝟬–𝟵 U+1D7EC
 *   italic      𝘈–𝘡 U+1D608 · 𝘢–𝘻 U+1D622 (no digit variants → left as-is)
 *   bold-italic 𝘼–𝙕 U+1D63C · 𝙖–𝙯 U+1D656 (digits reuse the bold set)
 */
export type Style = "bold" | "italic" | "bolditalic";

const MAPS: Record<Style, { upper: number; lower: number; digit?: number }> = {
  bold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  italic: { upper: 0x1d608, lower: 0x1d622 },
  bolditalic: { upper: 0x1d63c, lower: 0x1d656, digit: 0x1d7ec },
};

function styleChar(ch: string, m: { upper: number; lower: number; digit?: number }): string {
  const code = ch.codePointAt(0)!;
  if (code >= 65 && code <= 90) return String.fromCodePoint(m.upper + (code - 65)); // A–Z
  if (code >= 97 && code <= 122) return String.fromCodePoint(m.lower + (code - 97)); // a–z
  if (m.digit && code >= 48 && code <= 57) return String.fromCodePoint(m.digit + (code - 48)); // 0–9
  return ch;
}

/** Reverse lookup (styled code point → ASCII) so styles can be stripped/toggled. */
const REVERSE: Map<number, string> = (() => {
  const rev = new Map<number, string>();
  const add = (base: number, asciiStart: number, count: number) => {
    for (let i = 0; i < count; i++) rev.set(base + i, String.fromCharCode(asciiStart + i));
  };
  for (const m of Object.values(MAPS)) {
    add(m.upper, 65, 26);
    add(m.lower, 97, 26);
    if (m.digit) add(m.digit, 48, 10);
  }
  return rev;
})();

/** Convert styled glyphs back to plain ASCII (idempotent on already-plain text). */
export function stripStyles(text: string): string {
  return [...text].map((ch) => REVERSE.get(ch.codePointAt(0)!) ?? ch).join("");
}

/** Apply a style. Strips any existing style first, so toggling bold↔italic works. */
export function toStyle(text: string, style: Style): string {
  const m = MAPS[style];
  return [...stripStyles(text)].map((ch) => styleChar(ch, m)).join("");
}

export const toBold = (t: string) => toStyle(t, "bold");
export const toItalic = (t: string) => toStyle(t, "italic");
export const toBoldItalic = (t: string) => toStyle(t, "bolditalic");

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Bold every whole-word occurrence of each keyword/phrase in `text`
 * (case-insensitive, original case preserved). Longer phrases match first so
 * "AI agents" wins over "AI". Word boundaries are Unicode-aware, so a keyword
 * already inside a bold run is skipped (no double-styling).
 */
export function boldKeywords(text: string, keywords: string[]): string {
  let out = text;
  const kws = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  for (const kw of kws) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${escapeRegex(kw)})(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, (m) => toBold(m));
  }
  return out;
}
