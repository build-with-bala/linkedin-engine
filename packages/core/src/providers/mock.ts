import type {
  CompletionRequest,
  CompletionResult,
  Provider,
  ProviderConfig,
} from "./types.js";

/**
 * Deterministic provider for tests and offline dev. Emits well-formed output in
 * the HOOK OPTIONS / POST / NOTES contract, so the parser and persistence layer
 * can be exercised with no network, no CLI, and no API key.
 */
export class MockProvider implements Provider {
  readonly name = "mock";

  async isAvailable() {
    return true;
  }

  async complete(req: CompletionRequest, _cfg: ProviderConfig): Promise<CompletionResult> {
    const stage = req.meta?.stage ?? inferStage(req.prompt);
    const title = req.meta?.title ?? "this moment";
    const count = req.meta?.hookCount ?? 10;

    let text: string;
    if (stage === "hooks") {
      const hooks = Array.from(
        { length: count },
        (_, i) => `${i + 1}. ${hookVariant(title, i)}`,
      ).join("\n");
      text = `HOOK OPTIONS\n${hooks}\n`;
    } else if (stage === "media") {
      text = `MEDIA PROMPT\nA restrained, densely informative editorial infographic illustrating: ${title}. No stock imagery, no clichés.`;
    } else {
      const body = mockBody(title);
      text = `HOOK OPTIONS\n1. ${hookVariant(title, 0)}\n\nPOST\n${body}\n\nNOTES\n- Char count: ~${body.length}\n- Mock output (deterministic).`;
    }

    return { text, provider: this.name, model: "mock", latencyMs: 0 };
  }
}

function inferStage(prompt: string): string {
  if (/\b(\d+\s+)?hook options?\b/i.test(prompt) || /generate .*hooks/i.test(prompt))
    return "hooks";
  if (/media|image|infographic/i.test(prompt)) return "media";
  return "body";
}

function hookVariant(title: string, i: number): string {
  const frames = [
    `The part of "${title}" the timeline never showed.`,
    `I counted the steps. "${title}" was where I stopped pretending.`,
    `For most of last year, "${title}" did one job: it hid the work.`,
    `"${title}" looked like a setback. It was a forcing function.`,
    `Nobody saw the version of "${title}" that actually mattered.`,
    `"${title}" — and the quiet room right after it.`,
    `I did not plan "${title}". I responded to it.`,
    `The demo of "${title}" worked once. The real thing had to not break.`,
    `"${title}" taught me what a calendar cannot.`,
    `"${title}": the receipt, not the highlight reel.`,
    `What "${title}" cost, and what it returned.`,
  ];
  return frames[i % frames.length];
}

function mockBody(title: string): string {
  return [
    `It started with ${title}, and I almost kept it off the timeline.`,
    ``,
    `Both things were true at once. Neither one was the headline.`,
    ``,
    `I kept building because building was the place that still felt like me.`,
    ``,
    `What I learned did not arrive as a slogan. It arrived as a deploy that held.`,
  ].join("\n");
}
