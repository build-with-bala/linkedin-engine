/**
 * Best-effort public scraper for a LinkedIn post URL.
 *
 * Plain `fetch` gets the server-rendered HTML: og:title/description, visible
 * text, and links. LinkedIn renders comments client-side and gates much of the
 * page, so comment extraction is best-effort — when the HTML carries no
 * comment text, `comments` is empty and the caller records that honestly.
 * (A headless-browser fetcher can be swapped in behind this same interface.)
 */
export interface ScrapeResult {
  url: string;
  title?: string;
  description?: string;
  text: string;
  links: string[];
  comments: string[];
  likeCount?: number;
  commentCount?: number;
  repostCount?: number;
  ok: boolean;
  status: number;
  note?: string;
}

/**
 * The exact publish time of a LinkedIn post, decoded from its activity ID.
 * LinkedIn (Snowflake-style) IDs hold the creation time in the top 41 bits:
 * `timestamp_ms = id >> 22`. Far more accurate than "when I clicked posted".
 */
export function linkedInPostedAt(url: string): Date | null {
  const m =
    url.match(/activity[:-](\d{15,25})/i) ||
    url.match(/urn:li:activity:(\d{15,25})/i) ||
    url.match(/(\d{19})/);
  if (!m) return null;
  try {
    const ms = Number(BigInt(m[1]) >> 22n);
    // Sane range (~2004–2035) so a random number doesn't pass as a date.
    return ms > 1_100_000_000_000 && ms < 2_080_000_000_000 ? new Date(ms) : null;
  } catch {
    return null;
  }
}

/** Best-effort engagement counts from LinkedIn post HTML (JSON keys or visible text). */
export function extractCounts(html: string): {
  likeCount?: number;
  commentCount?: number;
  repostCount?: number;
} {
  const num = (patterns: RegExp[]): number | undefined => {
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const n = parseInt(m[1].replace(/[,\s]/g, ""), 10);
        if (!Number.isNaN(n)) return n;
      }
    }
    return undefined;
  };
  return {
    likeCount: num([
      /"numLikes"\s*:\s*(\d[\d,]*)/i,
      /"reactionCount"\s*:\s*(\d[\d,]*)/i,
      /"likeCount"\s*:\s*(\d[\d,]*)/i,
      /([\d,]+)\s+reactions?/i,
      /([\d,]+)\s+likes?/i,
    ]),
    commentCount: num([
      /"numComments"\s*:\s*(\d[\d,]*)/i,
      /"commentCount"\s*:\s*(\d[\d,]*)/i,
      /([\d,]+)\s+comments?/i,
    ]),
    repostCount: num([
      /"numShares"\s*:\s*(\d[\d,]*)/i,
      /"shareCount"\s*:\s*(\d[\d,]*)/i,
      /"repostCount"\s*:\s*(\d[\d,]*)/i,
      /([\d,]+)\s+reposts?/i,
    ]),
  };
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function pick(re: RegExp, html: string): string | undefined {
  const m = html.match(re);
  return m ? decodeEntities(m[1].trim()) : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x2F;/g, "/");
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLinks(html: string): string[] {
  const out = new Set<string>();
  const re = /href=["'](https?:\/\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const u = m[1];
    if (!/linkedin\.com\/(li\/|legal|help|signup|login|static)/i.test(u)) out.add(u);
  }
  return [...out].slice(0, 50);
}

export interface ScrapeOptions {
  timeoutMs?: number;
  /**
   * Optional headless-browser scrape service exposing `POST /scrape`. When set,
   * it is tried first (real browser, stealth) and the plain `fetch` path is the
   * fallback. Pass explicitly — the core library never reads process.env.
   */
  serviceUrl?: string;
}

/**
 * Scrape a URL. Prefers `serviceUrl` when provided; otherwise (or on failure)
 * falls back to a plain `fetch` of the server-rendered HTML.
 */
export async function scrapeUrl(url: string, opts: ScrapeOptions = {}): Promise<ScrapeResult> {
  const { timeoutMs = 20_000, serviceUrl: svc } = opts;
  if (svc) {
    try {
      const result = await scrapeViaService(svc.replace(/\/$/, ""), url, timeoutMs);
      if (result) return result;
    } catch {
      /* fall through to local fetch */
    }
  }
  return scrapeLocal(url, timeoutMs);
}

async function scrapeViaService(
  base: string,
  url: string,
  timeoutMs: number,
): Promise<ScrapeResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 25_000);
  try {
    const res = await fetch(`${base}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, mode: "auto", want: ["text", "links", "comments"] }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: Record<string, any> };
    const r = j.result;
    if (!r) return null;
    return {
      url,
      title: r.title ?? undefined,
      description: r.description ?? undefined,
      text: r.text ?? "",
      links: r.links ?? [],
      comments: r.comments ?? [],
      likeCount: r.likeCount ?? undefined,
      commentCount: r.commentCount ?? undefined,
      repostCount: r.repostCount ?? undefined,
      ok: !!r.ok,
      status: r.status ?? 0,
      note: r.note ?? `via service:${r.engine}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeLocal(url: string, timeoutMs = 20_000): Promise<ScrapeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
    const html = await res.text();
    const title = pick(/<meta property="og:title" content="([^"]*)"/i, html) || pick(/<title>([^<]*)<\/title>/i, html);
    const description = pick(/<meta property="og:description" content="([^"]*)"/i, html);
    const text = stripHtml(html).slice(0, 8000);
    const links = extractLinks(html);
    // Heuristic comment capture: LinkedIn sometimes inlines commentary text in JSON blobs.
    const comments: string[] = [];
    const cre = /"commentary"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{4,})"/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cre.exec(html)) && comments.length < 30) comments.push(decodeEntities(cm[1]));

    return {
      url,
      title,
      description,
      text,
      links,
      comments,
      ...extractCounts(html),
      ok: res.ok,
      status: res.status,
      note: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      url,
      text: "",
      links: [],
      comments: [],
      ok: false,
      status: 0,
      note: e instanceof Error ? e.message : "fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
