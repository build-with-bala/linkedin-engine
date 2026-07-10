import { assembleContext } from "./context.js";
import {
  type ProviderConfig,
  type ProviderRegistry,
  defaultRegistry,
  runWithFallback,
} from "./providers/index.js";
import { scrapeUrl, type ScrapeOptions } from "./scrape.js";
import type { Store } from "./storage.js";
import type { BrandConfig } from "./context.js";
import type { PostInput } from "./types.js";

/** Stable short id for a comment, for dedupe across scrapes. */
export function commentKey(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `c${(h >>> 0).toString(36)}`;
}

export interface InteractionResult {
  postId: string;
  scrapeRunId: string;
  ok: boolean;
  summary: string | null;
  links: string[];
  commentsFound: number;
  drafted: number;
  note?: string;
}

export interface InteractionsOptions {
  brand: BrandConfig;
  store: Store;
  providers: ProviderConfig[];
  registry?: ProviderRegistry;
  scrape?: ScrapeOptions;
}

/**
 * Scrape a post's live URL, summarize it, record links + engagement metrics,
 * and draft an on-brand reply for each *new* comment.
 *
 * Model failures degrade gracefully: a post whose summary or reply cannot be
 * generated is still scraped and recorded, with `summary: null`. Losing a
 * nice-to-have summary must never lose the metrics snapshot.
 */
export async function scrapeAndAnalyze(
  post: PostInput,
  opts: InteractionsOptions,
): Promise<InteractionResult> {
  if (!post.postedUrl) throw new Error("Post has no live URL yet — mark it posted first.");

  const registry = opts.registry ?? defaultRegistry();
  const scrape = await scrapeUrl(post.postedUrl, opts.scrape);

  const complete = async (prompt: string): Promise<string | null> => {
    try {
      const r = await runWithFallback(opts.providers, { prompt, timeoutMs: 90_000 }, { registry });
      return r.text;
    } catch {
      return null;
    }
  };

  let summary: string | null = null;
  if (scrape.text) {
    const raw = await complete(
      `In 2 sentences, summarize what this LinkedIn post is about and the gist of any discussion, from the scraped page text below.\n\n${scrape.text.slice(0, 3500)}`,
    );
    summary = raw ? raw.slice(0, 600).trim() : null;
  }

  const scrapeRun = await opts.store.recordScrape?.({
    postId: post.id,
    kind: "comments",
    url: post.postedUrl,
    summary,
    links: scrape.links,
    raw: scrape.text.slice(0, 8000),
    ok: scrape.ok,
    note: scrape.note,
  });

  const likes = scrape.likeCount ?? null;
  const commentsN = scrape.commentCount ?? (scrape.comments.length || null);
  const reposts = scrape.repostCount ?? null;
  if (likes !== null || commentsN !== null || reposts !== null) {
    await opts.store.recordMetric?.({ postId: post.id, likes, comments: commentsN, reposts });
  }

  let drafted = 0;
  if (scrape.comments.length) {
    const pack = await assembleContext({ brand: opts.brand, post });

    for (const text of scrape.comments) {
      const externalId = commentKey(text);
      if (await opts.store.findComment?.(post.id, externalId)) continue;

      let draftReply = await complete(
        `${pack.text}\n\n=== TASK ===\nA reader commented on this LinkedIn post:\n"${text}"\n\nDraft a short, warm, specific reply in the brand voice (1-2 sentences). No engagement bait, no clichés. If the comment needs no reply, output: SKIP.`,
      );
      draftReply = draftReply?.slice(0, 500).trim() ?? null;
      if (draftReply && /^skip$/i.test(draftReply)) draftReply = null;

      await opts.store.createComment?.({
        postId: post.id,
        text,
        externalId,
        draftReply,
        status: draftReply ? "drafted" : "new",
      });
      drafted++;
    }
  }

  return {
    postId: post.id,
    scrapeRunId: scrapeRun?.id ?? "",
    ok: scrape.ok,
    summary,
    links: scrape.links,
    commentsFound: scrape.comments.length,
    drafted,
    note: scrape.note,
  };
}

/** The periodic watcher: scrape every post published in the last `days` days. */
export async function runInteractionsSweep(
  opts: InteractionsOptions & { days?: number },
): Promise<{ checked: number; results: InteractionResult[] }> {
  const days = opts.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const posts = (await opts.store.listPostedSince?.(since)) ?? [];

  const results: InteractionResult[] = [];
  for (const p of posts) {
    try {
      results.push(await scrapeAndAnalyze(p, opts));
    } catch (e) {
      results.push({
        postId: p.id,
        scrapeRunId: "",
        ok: false,
        summary: null,
        links: [],
        commentsFound: 0,
        drafted: 0,
        note: e instanceof Error ? e.message : "failed",
      });
    }
  }
  return { checked: posts.length, results };
}
