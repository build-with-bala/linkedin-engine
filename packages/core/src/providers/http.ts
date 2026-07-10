import {
  type CompletionRequest,
  type CompletionResult,
  type Provider,
  type ProviderConfig,
  ProviderError,
  isRetryableStatus,
} from "./types.js";

/** POST JSON with a timeout, mapping transport failures to ProviderError. */
async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        `HTTP ${res.status}: ${text.slice(0, 300)}`,
        provider,
        res.status,
        isRetryableStatus(res.status),
      );
    }
    return await res.json();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    // Aborts and socket errors are transient — worth a retry or a fallback.
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = ctrl.signal.aborted && !signal?.aborted;
    throw new ProviderError(
      timedOut ? `timed out after ${timeoutMs}ms` : msg,
      provider,
      undefined,
      true,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT = 120_000;

const opt = (req: CompletionRequest, cfg: ProviderConfig) => ({
  maxTokens: req.maxTokens ?? cfg.maxTokens ?? DEFAULT_MAX_TOKENS,
  temperature: req.temperature ?? cfg.temperature,
  timeoutMs: req.timeoutMs ?? cfg.timeoutMs ?? DEFAULT_TIMEOUT,
});

/**
 * Anthropic Messages API.
 * Model ids current as of 2026-01: claude-opus-4-8 (deep reasoning),
 * claude-sonnet-5 (balanced default), claude-haiku-4-5-20251001 (fast/cheap).
 */
export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  static readonly defaultModel = "claude-sonnet-5";

  async isAvailable(cfg: ProviderConfig) {
    return Boolean(cfg.apiKey);
  }

  async complete(req: CompletionRequest, cfg: ProviderConfig): Promise<CompletionResult> {
    if (!cfg.apiKey) throw new ProviderError("missing apiKey", this.name, 401, false);
    const { maxTokens, temperature, timeoutMs } = opt(req, cfg);
    const model = cfg.model ?? AnthropicProvider.defaultModel;
    const started = Date.now();

    const json = await postJson(
      this.name,
      `${cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
      {
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
        ...cfg.headers,
      },
      {
        model,
        max_tokens: maxTokens,
        ...(temperature !== undefined && { temperature }),
        // A long, stable brand pack in `system` is exactly what prompt caching
        // is for — mark it ephemeral and repeat generations read it at ~10% cost.
        ...(req.system && {
          system: [
            { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
          ],
        }),
        messages: [{ role: "user", content: req.prompt }],
      },
      timeoutMs,
      req.signal,
    );

    const text = (json.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    return {
      text,
      provider: this.name,
      model,
      usage: {
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
      },
      latencyMs: Date.now() - started,
    };
  }
}

/** OpenAI Chat Completions. */
export class OpenAIProvider implements Provider {
  readonly name = "openai";
  static readonly defaultModel = "gpt-4o";

  async isAvailable(cfg: ProviderConfig) {
    return Boolean(cfg.apiKey);
  }

  async complete(req: CompletionRequest, cfg: ProviderConfig): Promise<CompletionResult> {
    if (!cfg.apiKey) throw new ProviderError("missing apiKey", this.name, 401, false);
    const { maxTokens, temperature, timeoutMs } = opt(req, cfg);
    const model = cfg.model ?? OpenAIProvider.defaultModel;
    const started = Date.now();

    const json = await postJson(
      this.name,
      `${cfg.baseUrl ?? "https://api.openai.com"}/v1/chat/completions`,
      { authorization: `Bearer ${cfg.apiKey}`, ...cfg.headers },
      {
        model,
        max_completion_tokens: maxTokens,
        ...(temperature !== undefined && { temperature }),
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          { role: "user", content: req.prompt },
        ],
      },
      timeoutMs,
      req.signal,
    );

    return {
      text: (json.choices?.[0]?.message?.content ?? "").trim(),
      provider: this.name,
      model,
      usage: {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      },
      latencyMs: Date.now() - started,
    };
  }
}

/** Google Gemini generateContent. */
export class GeminiProvider implements Provider {
  readonly name = "gemini";
  static readonly defaultModel = "gemini-2.0-flash";

  async isAvailable(cfg: ProviderConfig) {
    return Boolean(cfg.apiKey);
  }

  async complete(req: CompletionRequest, cfg: ProviderConfig): Promise<CompletionResult> {
    if (!cfg.apiKey) throw new ProviderError("missing apiKey", this.name, 401, false);
    const { maxTokens, temperature, timeoutMs } = opt(req, cfg);
    const model = cfg.model ?? GeminiProvider.defaultModel;
    const base = cfg.baseUrl ?? "https://generativelanguage.googleapis.com";
    const started = Date.now();

    const json = await postJson(
      this.name,
      `${base}/v1beta/models/${model}:generateContent`,
      { "x-goog-api-key": cfg.apiKey, ...cfg.headers },
      {
        ...(req.system && { systemInstruction: { parts: [{ text: req.system }] } }),
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(temperature !== undefined && { temperature }),
        },
      },
      timeoutMs,
      req.signal,
    );

    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p.text ?? "")
      .join("")
      .trim();

    return {
      text,
      provider: this.name,
      model,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount,
        outputTokens: json.usageMetadata?.candidatesTokenCount,
      },
      latencyMs: Date.now() - started,
    };
  }
}
