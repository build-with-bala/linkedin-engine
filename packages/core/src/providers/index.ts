import { AnthropicProvider, GeminiProvider, OpenAIProvider } from "./http.js";
import { ClaudeCliProvider, CodexCliProvider } from "./cli.js";
import { MockProvider } from "./mock.js";
import {
  AllProvidersFailedError,
  type CompletionRequest,
  type CompletionResult,
  type Provider,
  type ProviderConfig,
  ProviderError,
} from "./types.js";

export * from "./types.js";
export { AnthropicProvider, OpenAIProvider, GeminiProvider } from "./http.js";
export { CodexCliProvider, ClaudeCliProvider, spawnCapture } from "./cli.js";
export { MockProvider } from "./mock.js";

/**
 * A mutable registry so a host app can add its own backend without forking:
 *
 *   registry.register(new MyLlamaProvider());
 *   await engine.generate(post, { providers: [{ name: "my-llama" }] });
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  constructor(initial: Provider[] = []) {
    for (const p of initial) this.register(p);
  }

  register(provider: Provider): this {
    this.providers.set(provider.name, provider);
    return this;
  }

  get(name: string): Provider {
    const p = this.providers.get(name);
    if (!p) {
      throw new ProviderError(
        `Unknown provider "${name}". Registered: ${[...this.providers.keys()].join(", ")}`,
        name,
        undefined,
        false,
      );
    }
    return p;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }
}

/** The batteries-included set. Clone with `new ProviderRegistry(...)` to customize. */
export function defaultRegistry(): ProviderRegistry {
  return new ProviderRegistry([
    new AnthropicProvider(),
    new OpenAIProvider(),
    new GeminiProvider(),
    new CodexCliProvider(),
    new ClaudeCliProvider(),
    new MockProvider(),
  ]);
}

export interface ChainOptions {
  /** Retries per provider for *retryable* failures. Default 2 (so 3 tries each). */
  retriesPerProvider?: number;
  /** Base backoff in ms; doubles each retry. Default 500. */
  backoffMs?: number;
  registry?: ProviderRegistry;
  /** Observability hook: fires once per attempt, success or failure. */
  onAttempt?: (info: {
    provider: string;
    attempt: number;
    ok: boolean;
    error?: string;
    latencyMs?: number;
  }) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Try each provider config in order. Within a provider, retry retryable errors
 * with exponential backoff; on a terminal error (bad key, malformed request),
 * skip straight to the next provider. Throws AllProvidersFailedError only when
 * the whole chain is exhausted.
 */
export async function runWithFallback(
  configs: ProviderConfig[],
  req: CompletionRequest,
  opts: ChainOptions = {},
): Promise<CompletionResult> {
  if (!configs.length) throw new Error("runWithFallback: no providers configured");

  const registry = opts.registry ?? defaultRegistry();
  const retries = opts.retriesPerProvider ?? 2;
  const backoff = opts.backoffMs ?? 500;
  const attempts: Array<{ provider: string; error: string }> = [];

  for (const cfg of configs) {
    let provider: Provider;
    try {
      provider = registry.get(cfg.name);
    } catch (e) {
      attempts.push({ provider: cfg.name, error: (e as Error).message });
      continue;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (req.signal?.aborted) throw new Error("aborted");
      try {
        const result = await provider.complete(req, cfg);
        if (!result.text.trim()) {
          throw new ProviderError("empty completion", cfg.name, undefined, true);
        }
        opts.onAttempt?.({
          provider: cfg.name,
          attempt,
          ok: true,
          latencyMs: result.latencyMs,
        });
        return result;
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError(String(e), cfg.name);
        opts.onAttempt?.({
          provider: cfg.name,
          attempt,
          ok: false,
          error: err.message,
        });
        attempts.push({ provider: cfg.name, error: err.message });

        const canRetry = err.retryable && attempt < retries;
        if (!canRetry) break; // terminal, or out of retries → next provider
        await sleep(backoff * 2 ** attempt);
      }
    }
  }

  throw new AllProvidersFailedError(attempts);
}
