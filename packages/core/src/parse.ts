/**
 * Parsers for model output. The default prompt templates ask the model to
 * emit this contract:
 *
 *   HOOK OPTIONS
 *   1. ...
 *   2. ...
 *
 *   POST
 *   <body>
 *
 *   NOTES
 *   - ...
 *
 * These parsers are deliberately forgiving so a slightly-off model still parses.
 */

/** Extract numbered hook lines. Falls back to any numbered list if no HOOK header. */
export function parseHooks(output: string): string[] {
  const lines = output.split(/\r?\n/);
  let inHookBlock = false;
  let sawHeader = false;
  const hooks: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (/^hook options/i.test(line) || /^hooks?$/i.test(line)) {
      inHookBlock = true;
      sawHeader = true;
      continue;
    }
    // A POST/NOTES header ends the hook block.
    if (sawHeader && /^(post|notes|body)\b/i.test(line)) break;

    const m = line.match(/^(?:\d+|[-*])[.)]?\s+(.*\S)/);
    if (m) {
      // Only collect once we are in (or after) the header when a header exists.
      if (!sawHeader || inHookBlock) hooks.push(stripQuotes(m[1]));
    }
  }
  return dedupe(hooks).slice(0, 20);
}

/** Extract the POST body. Falls back to "everything after the hooks" when unlabeled. */
export function parseBody(output: string): string {
  const lines = output.split(/\r?\n/);
  const postIdx = lines.findIndex((l) => /^\s*POST\s*$/i.test(l));

  if (postIdx !== -1) {
    const rest = lines.slice(postIdx + 1);
    // Cut at the first trailing section header (NOTES / HOOK OPTIONS / CHAR COUNT).
    const endRel = rest.findIndex((l) =>
      /^\s*(NOTES|HOOK OPTIONS|CHAR COUNT)\b/i.test(l),
    );
    const bodyLines = endRel === -1 ? rest : rest.slice(0, endRel);
    return cleanup(bodyLines.join("\n"));
  }

  // No POST header: drop a leading HOOK OPTIONS block if present, return the rest.
  const withoutHooks = output.replace(
    /^[\s\S]*?HOOK OPTIONS[\s\S]*?(?:\n\s*\n)/i,
    "",
  );
  return cleanup(withoutHooks === output ? output : withoutHooks);
}

function stripQuotes(s: string): string {
  return s.replace(/^["“'']+/, "").replace(/["”'']+$/, "").trim();
}

function cleanup(s: string): string {
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k) || x.length === 0) return false;
    seen.add(k);
    return true;
  });
}

export function charCount(s: string): number {
  return s.length;
}
