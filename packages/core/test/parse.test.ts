import { describe, it, expect } from "vitest";
import { parseHooks, parseBody } from "../src/parse.js";

const SKILL_FORMAT = `HOOK OPTIONS
1. My LinkedIn said co-founder and CTO. It did not say I was reading it from a wheelchair.
2. For most of last year, my headline did one job well: it hid the work.
3. The version of me on this profile was true. Just not the whole story.

POST
My LinkedIn said co-founder and CTO of an AI startup.

Both were true. Neither showed the part in between.

Built through breakdowns. Still building forward.

NOTES
- Char count: ~140`;

describe("parseHooks", () => {
  it("extracts numbered hooks under the HOOK OPTIONS header and stops at POST", () => {
    const hooks = parseHooks(SKILL_FORMAT);
    expect(hooks).toHaveLength(3);
    expect(hooks[0]).toMatch(/co-founder and CTO/);
    // The POST body line must NOT leak into hooks.
    expect(hooks.some((h) => /part in between/.test(h))).toBe(false);
  });

  it("strips surrounding quotes", () => {
    const hooks = parseHooks(`HOOK OPTIONS\n1. "a quoted hook"\n`);
    expect(hooks[0]).toBe("a quoted hook");
  });

  it("dedupes and caps at 20", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `${i + 1}. hook ${i % 3}`);
    const hooks = parseHooks(`HOOK OPTIONS\n${lines.join("\n")}`);
    expect(hooks).toEqual(["hook 0", "hook 1", "hook 2"]);
  });

  it("falls back to any numbered list when no header is present", () => {
    expect(parseHooks("1. alpha\n2. beta")).toEqual(["alpha", "beta"]);
  });
});

describe("parseBody", () => {
  it("extracts the POST block and drops HOOK/NOTES sections", () => {
    const body = parseBody(SKILL_FORMAT);
    expect(body).toMatch(/^My LinkedIn said co-founder/);
    expect(body).toMatch(/Built through breakdowns/);
    expect(body).not.toMatch(/HOOK OPTIONS/);
    expect(body).not.toMatch(/Char count/);
  });

  it("returns whole text when unlabeled", () => {
    expect(parseBody("just a plain body")).toBe("just a plain body");
  });
});
