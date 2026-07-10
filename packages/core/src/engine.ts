import { assembleContext, type BrandConfig, type ContextItem } from "./context.js";
import { charCount, parseBody, parseHooks } from "./parse.js";
import {
  type ChainOptions,
  type ProviderConfig,
  ProviderRegistry,
  defaultRegistry,
  runWithFallback,
} from "./providers/index.js";
import type { Store } from "./storage.js";
import type { PostInput, Stage } from "./types.js";

/** Built-in prompts, used when the caller supplies no template for a stage. */
export const DEFAULT_PROMPTS: Record<Stage, string> = {
  hooks:
    "Using only the system context above, write {{hookCount}} distinct LinkedIn hook options for THIS POST. Each must be a specific, real, scroll-stopping opening line — no clichés, no engagement bait. Output exactly:\nHOOK OPTIONS\n1. ...\n(through {{hookCount}}).",
  body: "Using only the system context above, write the full LinkedIn post for THIS POST in the brand voice. Follow the retention arc (specific opening → surfaced expectation → what happened → discomfort → grounded shift → reflective close). Output:\nHOOK OPTIONS\n1-3 hooks\n\nPOST\n<post>\n\nNOTES\n- any [NEEDS FACT] gaps · char count.",
  media:
    "Propose ONE image/infographic concept for THIS POST in the brand design language. Graphically sophisticated AND densely informative. Output a single MEDIA PROMPT paragraph.",
  regenerate:
    "Regenerate the LinkedIn post for THIS POST, applying the ADDITIONAL INSTRUCTIONS below. Keep the brand voice and all guardrails. Output:\nHOOK OPTIONS\n1-3 hooks\n\nPOST\n<post>\n\nNOTES\n- char count.",
};

export interface EngineOptions {
  brand: BrandConfig;
  store?: Store;
  registry?: ProviderRegistry;
  /** Defaults applied to every `generate` call that omits `providers`. */
  defaultProviders?: ProviderConfig[];
  chain?: Omit<ChainOptions, "registry">;
  /**
   * Send the brand pack as a real system prompt instead of prepending it to the
   * user turn. Enables Anthropic prompt caching. Default true.
   */
  useSystemPrompt?: boolean;
}

export interface GenerateArgs {
  stage: Stage;
  /** Ordered fallback chain; overrides `defaultProviders`. */
  providers?: ProviderConfig[];
  promptTemplate?: string;
  extraInputs?: string;
  includeFullStory?: boolean;
  hookCount?: number;
  userContext?: ContextItem[];
  signal?: AbortSignal;
}

export interface GenerateResult {
  runId?: string;
  stage: Stage;
  provider: string;
  model?: string;
  latencyMs: number;
  contextChars: number;
  /** Brand files that were declared but unreadable. Worth surfacing in a UI. */
  missingSources: string[];
  hooks?: string[];
  body?: string;
  mediaPrompt?: string;
  output: string;
}

export class LinkedInEngine {
  private readonly registry: ProviderRegistry;

  constructor(private readonly opts: EngineOptions) {
    this.registry = opts.registry ?? defaultRegistry();
  }

  get providers(): string[] {
    return this.registry.names();
  }

  /**
   * Generate for a post you pass in directly — no store required.
   * This is the stateless entry point for embedding in a larger product.
   */
  async generateFor(post: PostInput, args: GenerateArgs): Promise<GenerateResult> {
    const {
      stage,
      promptTemplate,
      extraInputs,
      includeFullStory,
      hookCount = 10,
      userContext = [],
      signal,
    } = args;

    const providers = args.providers ?? this.opts.defaultProviders;
    if (!providers?.length) {
      throw new Error("generate: no providers given and no defaultProviders configured");
    }

    const pack = await assembleContext({
      brand: this.opts.brand,
      post,
      userContext,
      includeFullStory,
    });

    const task = (promptTemplate ?? DEFAULT_PROMPTS[stage]).replace(
      /\{\{hookCount\}\}/g,
      String(hookCount),
    );
    const taskPrompt =
      `=== TASK ===\n${task}` +
      (extraInputs ? `\n\nADDITIONAL INSTRUCTIONS:\n${extraInputs}` : "");

    const useSystem = this.opts.useSystemPrompt ?? true;
    const result = await runWithFallback(
      providers,
      {
        system: useSystem ? pack.text : undefined,
        prompt: useSystem ? taskPrompt : `${pack.text}\n\n${taskPrompt}`,
        signal,
        meta: { stage, hookCount, title: post.title, type: String(post.type) },
      },
      { ...this.opts.chain, registry: this.registry },
    );

    const out: GenerateResult = {
      stage,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      contextChars: pack.chars,
      missingSources: pack.missing,
      output: result.text,
    };

    const store = this.opts.store;
    const run = await store?.recordGeneration?.({
      postId: post.id,
      provider: result.provider,
      model: result.model,
      stage,
      prompt: taskPrompt,
      output: result.text,
      contextChars: pack.chars,
      inputs: { extraInputs, includeFullStory, hookCount },
    });
    out.runId = run?.id;

    if (stage === "hooks") {
      out.hooks = parseHooks(result.text);
      await store?.saveHooks?.(post.id, out.hooks, result.provider);
    } else if (stage === "media") {
      out.mediaPrompt =
        result.text.replace(/^.*MEDIA PROMPT\s*/is, "").trim() || result.text.trim();
      await store?.saveMedia?.(post.id, out.mediaPrompt);
    } else {
      const body = parseBody(result.text);
      out.body = body;
      await store?.updatePost?.(post.id, {
        body,
        charCount: charCount(body),
        status: post.status === "idea" ? "draft" : post.status,
      });

      // Seed hooks from this output only when the post has none yet.
      if ((await store?.countHooks?.(post.id)) === 0) {
        const hooks = parseHooks(result.text);
        if (hooks.length) {
          await store?.saveHooks?.(post.id, hooks, result.provider);
          out.hooks = hooks;
        }
      }
    }

    return out;
  }

  /** Store-backed convenience wrapper: look the post up by id, then generate. */
  async generate(postId: string, args: GenerateArgs): Promise<GenerateResult> {
    const store = this.opts.store;
    if (!store) throw new Error("generate(postId) requires a `store`; use generateFor(post, …)");
    const post = await store.getPost(postId);
    if (!post) throw new Error(`Post not found: ${postId}`);
    return this.generateFor(post, args);
  }
}
