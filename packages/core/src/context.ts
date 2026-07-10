import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PostInput } from "./types.js";

/**
 * The system pack: the brand documents loaded into EVERY generation so the
 * model is never writing "cold". In the original app these were five hardcoded
 * vault paths; here the caller declares them, so any tenant can bring their own
 * voice guide, guardrails and pillar list.
 */
export interface BrandConfig {
  /** Display name used in the system header, e.g. "Acme" or a person's name. */
  name: string;
  /** Root the `files` paths resolve against. */
  baseDir?: string;
  /** Ordered, relative paths. Order matters — put voice + guardrails first. */
  files?: string[];
  /** Loaded on demand for heavier fact grounding (long-form bio, story doc). */
  fullStoryFile?: string;
  /**
   * Literal blocks, merged after the files. Lets a host app supply brand context
   * straight from its own database with no filesystem at all.
   */
  inline?: ContextItem[];
}

export interface ContextItem {
  label: string;
  content: string;
}

export interface ContextPack {
  text: string;
  chars: number;
  sources: string[];
  /** Declared files that could not be read. Surfaced, never silently ignored. */
  missing: string[];
}

async function tryRead(baseDir: string, rel: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(baseDir, rel), "utf8");
  } catch {
    return null;
  }
}

/**
 * Assemble: system header → brand files → this post → user-supplied context.
 * The result is prepended to the task prompt (or passed as a system prompt).
 */
export async function assembleContext(opts: {
  brand: BrandConfig;
  post: PostInput;
  userContext?: ContextItem[];
  includeFullStory?: boolean;
}): Promise<ContextPack> {
  const { brand, post, userContext = [], includeFullStory } = opts;
  const sources: string[] = [];
  const missing: string[] = [];
  const blocks: string[] = [];

  blocks.push(
    [
      `=== ${brand.name.toUpperCase()} — SYSTEM CONTEXT (always loaded) ===`,
      `You are writing/critiquing in ${brand.name}'s voice. Honor every guardrail below.`,
      "If a required fact is missing, do NOT invent it — flag it as [NEEDS FACT: ...].",
    ].join("\n"),
  );

  const baseDir = brand.baseDir ?? "";
  const files = [...(brand.files ?? [])];
  if (includeFullStory && brand.fullStoryFile) files.push(brand.fullStoryFile);

  if (baseDir) {
    for (const rel of files) {
      const content = await tryRead(baseDir, rel);
      if (content == null) {
        missing.push(rel);
        continue;
      }
      sources.push(rel);
      blocks.push(`\n--- SOURCE: ${rel} ---\n${content.trim()}`);
    }
  } else {
    missing.push(...files);
  }

  for (const item of brand.inline ?? []) {
    sources.push(item.label);
    blocks.push(`\n--- SOURCE: ${item.label} ---\n${item.content.trim()}`);
  }

  blocks.push(
    [
      "\n=== THIS POST ===",
      `Type: ${post.type}`,
      `Title: ${post.title}`,
      post.pillar ? `Pillar: ${post.pillar}` : "",
      post.beatRef ? `Beat reference: ${post.beatRef}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (userContext.length) {
    blocks.push("\n=== USER-SUPPLIED CONTEXT ===");
    for (const item of userContext) {
      blocks.push(`\n--- ${item.label} ---\n${item.content.trim()}`);
    }
  }

  const text = blocks.join("\n");
  return { text, chars: text.length, sources, missing };
}
