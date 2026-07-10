import { describe, expect, it, vi } from "vitest";
import {
  AllProvidersFailedError,
  type CompletionResult,
  type Provider,
  type ProviderConfig,
  ProviderError,
  ProviderRegistry,
  runWithFallback,
} from "../src/providers/index.js";

/** A scriptable provider: each call shifts one outcome off the queue. */
function fake(name: string, outcomes: Array<"ok" | "retryable" | "terminal" | "empty">): Provider {
  const queue = [...outcomes];
  return {
    name,
    async isAvailable() {
      return true;
    },
    async complete(): Promise<CompletionResult> {
      const next = queue.shift() ?? "terminal";
      if (next === "retryable") throw new ProviderError("503 boom", name, 503, true);
      if (next === "terminal") throw new ProviderError("401 bad key", name, 401, false);
      if (next === "empty") return { text: "   ", provider: name, latencyMs: 1 };
      return { text: `hello from ${name}`, provider: name, model: "m", latencyMs: 1 };
    },
  };
}

const cfg = (name: string): ProviderConfig => ({ name });
const req = { prompt: "write a post" };
const noBackoff = { backoffMs: 0 };

describe("runWithFallback", () => {
  it("returns the first provider's result without touching the fallback", async () => {
    const secondary = fake("secondary", ["ok"]);
    const spy = vi.spyOn(secondary, "complete");
    const registry = new ProviderRegistry([fake("primary", ["ok"]), secondary]);

    const r = await runWithFallback([cfg("primary"), cfg("secondary")], req, {
      registry,
      ...noBackoff,
    });

    expect(r.text).toBe("hello from primary");
    expect(r.provider).toBe("primary");
    expect(spy).not.toHaveBeenCalled();
  });

  it("retries a retryable failure on the same provider before falling back", async () => {
    const registry = new ProviderRegistry([fake("primary", ["retryable", "ok"])]);
    const onAttempt = vi.fn();

    const r = await runWithFallback([cfg("primary")], req, {
      registry,
      onAttempt,
      ...noBackoff,
    });

    expect(r.provider).toBe("primary");
    expect(onAttempt).toHaveBeenCalledTimes(2);
    expect(onAttempt.mock.calls[0][0]).toMatchObject({ ok: false, attempt: 0 });
    expect(onAttempt.mock.calls[1][0]).toMatchObject({ ok: true, attempt: 1 });
  });

  it("does NOT retry a terminal failure — it skips straight to the next provider", async () => {
    const primary = fake("primary", ["terminal", "ok"]); // the "ok" must never be reached
    const spy = vi.spyOn(primary, "complete");
    const registry = new ProviderRegistry([primary, fake("secondary", ["ok"])]);

    const r = await runWithFallback([cfg("primary"), cfg("secondary")], req, {
      registry,
      ...noBackoff,
    });

    expect(r.provider).toBe("secondary");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries then falls back to the next provider", async () => {
    const registry = new ProviderRegistry([
      fake("primary", ["retryable", "retryable", "retryable"]),
      fake("secondary", ["ok"]),
    ]);

    const r = await runWithFallback([cfg("primary"), cfg("secondary")], req, {
      registry,
      retriesPerProvider: 2,
      ...noBackoff,
    });

    expect(r.provider).toBe("secondary");
  });

  it("treats an empty completion as retryable", async () => {
    const registry = new ProviderRegistry([fake("primary", ["empty", "ok"])]);
    const r = await runWithFallback([cfg("primary")], req, { registry, ...noBackoff });
    expect(r.text).toBe("hello from primary");
  });

  it("throws AllProvidersFailedError listing every attempt when the chain is exhausted", async () => {
    const registry = new ProviderRegistry([
      fake("primary", ["terminal"]),
      fake("secondary", ["terminal"]),
    ]);

    await expect(
      runWithFallback([cfg("primary"), cfg("secondary")], req, { registry, ...noBackoff }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("skips an unregistered provider rather than aborting the chain", async () => {
    const registry = new ProviderRegistry([fake("secondary", ["ok"])]);
    const r = await runWithFallback([cfg("ghost"), cfg("secondary")], req, {
      registry,
      ...noBackoff,
    });
    expect(r.provider).toBe("secondary");
  });

  it("rejects an empty provider list", async () => {
    await expect(runWithFallback([], req)).rejects.toThrow(/no providers configured/);
  });

  it("lets a host register a custom provider", async () => {
    const registry = new ProviderRegistry().register(fake("my-llama", ["ok"]));
    const r = await runWithFallback([cfg("my-llama")], req, { registry, ...noBackoff });
    expect(r.text).toBe("hello from my-llama");
  });
});
