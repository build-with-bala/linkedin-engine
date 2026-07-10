import { describe, it, expect } from "vitest";
import { toBold, toItalic, toBoldItalic, stripStyles, boldKeywords } from "../src/format.js";

describe("unicode-format", () => {
  it("bolds letters and digits to sans-serif glyphs", () => {
    expect(toBold("AI 2027")).toBe("𝗔𝗜 𝟮𝟬𝟮𝟳");
    expect(toBold("Build")).toBe("𝗕𝘂𝗶𝗹𝗱");
  });

  it("italicizes letters (digits unchanged — no sans italic digits)", () => {
    expect(toItalic("ab")).toBe("𝘢𝘣");
    expect(toItalic("a1")).toBe("𝘢1");
  });

  it("round-trips: strip(style(x)) === x", () => {
    const s = "Built through breakdowns 123";
    expect(stripStyles(toBold(s))).toBe(s);
    expect(stripStyles(toItalic(s))).toBe(s);
    expect(stripStyles(toBoldItalic(s))).toBe(s);
  });

  it("toggles bold↔italic by stripping first", () => {
    expect(toItalic(toBold("Hi"))).toBe(toItalic("Hi"));
  });

  it("bolds whole-word keyword occurrences, case-insensitive", () => {
    const out = boldKeywords("AI agents and ai tooling", ["AI"]);
    expect(out).toContain(toBold("AI"));
    expect(out).toContain(toBold("ai"));
    // 'agents' untouched
    expect(out).toContain("agents");
  });

  it("does not bold inside a larger word", () => {
    const out = boldKeywords("brainstorm", ["brain"]);
    expect(out).toBe("brainstorm");
  });

  it("prefers longer phrases over their substrings", () => {
    const out = boldKeywords("AI agents shipped", ["AI", "AI agents"]);
    expect(out).toContain(toBold("AI agents"));
  });

  it("leaves non-keyword text byte-identical", () => {
    expect(boldKeywords("nothing here", ["xyz"])).toBe("nothing here");
  });
});
