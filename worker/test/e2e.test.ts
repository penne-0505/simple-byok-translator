// Opt-in real E2E against OpenRouter. Skipped unless TRANSLATOR_E2E=1 and a key
// is provided, so the default `vitest run` never hits the network.
//
//   TRANSLATOR_E2E=1 OPENROUTER_KEY=sk-or-... npx vitest run test/e2e.test.ts

import { describe, expect, it } from "vitest";

import { ConfigStore } from "../src/config";
import { TranslationEngine } from "../src/engine";
import { OpenRouterProvider } from "../src/provider";
import { TranslateRequestSchema } from "../src/schemas";

const KEY = process.env.OPENROUTER_KEY ?? "";
const RUN = process.env.TRANSLATOR_E2E === "1" && KEY.length > 0;

function engine() {
  return new TranslationEngine(new ConfigStore(), new OpenRouterProvider({ title: "byok-e2e" }));
}
const creds = { apiKey: KEY };
const req = (o: Record<string, unknown>) => TranslateRequestSchema.parse(o);

describe.skipIf(!RUN)("real OpenRouter E2E", () => {
  it("translates with the default model", async () => {
    const out = await engine().translate(
      req({ text: "おはよう。", target_language: "English" }),
      creds,
    );
    expect(out.translation.toLowerCase()).toContain("morning");
    expect(out.model).toContain("gemini-3.1-flash-lite");
  });

  it("honors reasoning_effort", async () => {
    const out = await engine().translate(
      req({ text: "急がば回れ。", target_language: "English", reasoning_effort: "low" }),
      creds,
    );
    expect(out.translation.length).toBeGreaterThan(0);
  });

  it("streams clean deltas", async () => {
    const chunks: string[] = [];
    for await (const d of engine().stream(
      req({ text: "Hello, world.", target_language: "Japanese" }),
      creds,
    )) {
      chunks.push(d);
    }
    const joined = chunks.join("");
    expect(joined.length).toBeGreaterThan(0);
    expect(joined).not.toContain("<<<"); // raw profile → no delimiters leak
  });
});
