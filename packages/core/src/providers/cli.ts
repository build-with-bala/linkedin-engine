import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type CompletionRequest,
  type CompletionResult,
  type Provider,
  type ProviderConfig,
  ProviderError,
} from "./types.js";

/** Spawn a binary, write stdin, capture stdout, enforce a timeout. */
export function spawnCapture(
  bin: string,
  args: string[],
  stdin: string,
  timeoutMs = 180_000,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      reject(err);
      return;
    }

    let out = "";
    let err = "";
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(() => reject(new Error(`${bin} timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    const onAbort = () => {
      child.kill("SIGKILL");
      done(() => reject(new Error(`${bin} aborted`)));
    };
    signal?.addEventListener("abort", onAbort);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => done(() => reject(e)));
    child.on("close", (code) =>
      done(() =>
        code === 0
          ? resolve(out.trim())
          : reject(new Error(`${bin} exited ${code}: ${err.slice(0, 500)}`)),
      ),
    );

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function binWorks(bin: string): Promise<boolean> {
  try {
    await spawnCapture(bin, ["--version"], "", 10_000);
    return true;
  } catch {
    return false;
  }
}

const wrap = (provider: string, e: unknown): never => {
  const msg = e instanceof Error ? e.message : String(e);
  // CLI failures (crash, timeout, transient auth refresh) are worth falling past.
  throw new ProviderError(msg, provider, undefined, true);
};

/**
 * Codex CLI. Requires an already-logged-in `codex` on the host — no API key.
 * The prompt goes as an argv arg and the answer is read from
 * `--output-last-message`, so the TUI framing never reaches the parser.
 */
export class CodexCliProvider implements Provider {
  readonly name = "codex-cli";

  async isAvailable(cfg: ProviderConfig) {
    return binWorks(cfg.bin ?? "codex");
  }

  async complete(req: CompletionRequest, cfg: ProviderConfig): Promise<CompletionResult> {
    const bin = cfg.bin ?? "codex";
    const baseArgs = cfg.args ?? ["exec", "--skip-git-repo-check"];
    const outFile = join(tmpdir(), `codex-${process.pid}-${randomUUID()}.txt`);
    const prompt = req.system ? `${req.system}\n\n${req.prompt}` : req.prompt;
    const started = Date.now();

    try {
      await spawnCapture(
        bin,
        [...baseArgs, "--output-last-message", outFile, prompt],
        "",
        req.timeoutMs ?? cfg.timeoutMs ?? 180_000,
        req.signal,
      );
      const text = (await readFile(outFile, "utf8")).trim();
      return { text, provider: this.name, model: cfg.model, latencyMs: Date.now() - started };
    } catch (e) {
      return wrap(this.name, e);
    } finally {
      await unlink(outFile).catch(() => {});
    }
  }
}

/** Claude Code CLI in headless print mode. Must be logged in on the host. */
export class ClaudeCliProvider implements Provider {
  readonly name = "claude-cli";

  async isAvailable(cfg: ProviderConfig) {
    return binWorks(cfg.bin ?? "claude");
  }

  async complete(req: CompletionRequest, cfg: ProviderConfig): Promise<CompletionResult> {
    const bin = cfg.bin ?? "claude";
    const args = cfg.args ?? ["-p", "--output-format", "text"];
    const prompt = req.system ? `${req.system}\n\n${req.prompt}` : req.prompt;
    const started = Date.now();

    try {
      const text = await spawnCapture(
        bin,
        args,
        prompt,
        req.timeoutMs ?? cfg.timeoutMs ?? 180_000,
        req.signal,
      );
      return { text, provider: this.name, model: cfg.model, latencyMs: Date.now() - started };
    } catch (e) {
      return wrap(this.name, e);
    }
  }
}
