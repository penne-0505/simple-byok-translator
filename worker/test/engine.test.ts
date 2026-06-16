import { describe, expect, it } from "vitest";

import { ProviderError } from "../src/errors";
import { TranslationEngine } from "../src/engine";
import { FakeProvider, makeStore, req } from "./helpers";

describe("TranslationEngine", () => {
  it("extracts and threads credentials through to the provider", async () => {
    const provider = new FakeProvider({
      reply: "noise [[hola]] noise",
      usage: { totalTokens: 5 },
    });
    const engine = new TranslationEngine(makeStore(), provider);

    const outcome = await engine.translate(
      req({ text: "hello", profile: "general" }),
      { apiKey: "sk-or-test" },
    );

    expect(outcome.translation).toBe("hola");
    expect(outcome.usage?.totalTokens).toBe(5);
    expect(provider.calls[0].credentials.apiKey).toBe("sk-or-test");
    expect(provider.calls[0].request.model).toBe("google/gemini-2.5-flash");
  });

  it("uses the resolved profile temperature", async () => {
    const provider = new FakeProvider({ reply: "<t>hej</t>" });
    const engine = new TranslationEngine(makeStore(), provider);
    const outcome = await engine.translate(
      req({ text: "hi", model: "anthropic/claude-haiku-4.5" }),
      { apiKey: "k" },
    );
    expect(outcome.translation).toBe("hej");
    expect(provider.calls[0].request.sampling.temperature).toBe(0.2);
  });

  it("streams raw deltas", async () => {
    const provider = new FakeProvider({ deltas: ["ho", "la"] });
    const engine = new TranslationEngine(makeStore(), provider);
    const chunks: string[] = [];
    for await (const c of engine.stream(req({ text: "hi" }), { apiKey: "k" })) {
      chunks.push(c);
    }
    expect(chunks).toEqual(["ho", "la"]);
  });

  it("defaults streaming to a delimiter-free profile", async () => {
    const provider = new FakeProvider({ deltas: ["x"] });
    const engine = new TranslationEngine(makeStore(), provider);
    for await (const _ of engine.stream(
      req({ text: "hi", model: "google/gemini-2.5-flash" }),
      { apiKey: "k" },
    )) {
      /* drain */
    }
    expect(provider.calls[0].request.messages[0].content).not.toContain("<<<");
  });

  it("honors an explicit profile when streaming", async () => {
    const provider = new FakeProvider({ deltas: ["x"] });
    const engine = new TranslationEngine(makeStore(), provider);
    for await (const _ of engine.stream(
      req({ text: "hi", profile: "general" }),
      { apiKey: "k" },
    )) {
      /* drain */
    }
    expect(provider.calls[0].request.messages[0].content).toContain("[[");
  });

  it("propagates provider errors", async () => {
    const provider = new FakeProvider({ error: new ProviderError("boom", 429) });
    const engine = new TranslationEngine(makeStore(), provider);
    await expect(engine.translate(req({ text: "hi" }), { apiKey: "k" })).rejects.toMatchObject({
      statusCode: 429,
    });
  });
});
