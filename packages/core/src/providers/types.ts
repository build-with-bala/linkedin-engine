/**
 * The provider contract. Everything the engine needs from a model backend is
 * one method: turn a system prompt + a task prompt into text.
 *
 * Providers are STATELESS. All credentials and model choice arrive per call in
 * `ProviderConfig`, never from module-level env reads. That is what makes the
 * engine safe to embed in a multi-tenant product: two concurrent requests can
 * use two different customers' API keys without touching shared state.
 */

export interface ProviderConfig {
  /** Registry key: "anthropic" | "openai" | "gemini" | "codex-cli" | "claude-cli" | "mock" | custom. */
  name: string;
  /** Per-request credential. Omitted for CLI/mock providers. */
  apiKey?: string;
  /** Model id. Each provider supplies a sane default when this is absent. */
  model?: string;
  /** Override the API host (proxies, Azure/Bedrock-style gateways, self-hosted). */
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** CLI providers only: binary path and argv. */
  bin?: string;
  args?: string[];
  /** Extra headers merged into the HTTP request (e.g. an org id, a gateway token). */
  headers?: Record<string, string>;
}

export interface CompletionRequest {
  /** Brand/system context. Sent as a real system prompt where supported. */
  system?: string;
  /** The task. */
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Opaque hints; only the mock provider reads these. */
  meta?: { stage?: string; hookCount?: number; title?: string; type?: string };
}

export interface CompletionResult {
  text: string;
  provider: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Milliseconds spent in the provider call. */
  latencyMs: number;
}

export interface Provider {
  readonly name: string;
  complete(req: CompletionRequest, cfg: ProviderConfig): Promise<CompletionResult>;
  /** Cheap liveness check: binary on PATH, or credential present. */
  isAvailable(cfg: ProviderConfig): Promise<boolean>;
}

/**
 * A provider failure the chain is allowed to retry or fall back past:
 * rate limits, 5xx, timeouts, socket errors. A 401 or a 400 is NOT retryable —
 * retrying a bad key just burns latency.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Thrown when every provider in the chain has been exhausted. */
export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: Array<{ provider: string; error: string }>) {
    super(
      `All ${attempts.length} provider attempt(s) failed: ` +
        attempts.map((a) => `${a.provider}: ${a.error}`).join(" | "),
    );
    this.name = "AllProvidersFailedError";
  }
}

/** Map an HTTP status to retryable/terminal. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
