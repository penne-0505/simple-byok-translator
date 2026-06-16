import { describe, expect, it } from "vitest";

import { buildChatRequest, extractTranslation } from "../src/harness";
import { makeStore, req } from "./helpers";

const store = makeStore();

describe("harness", () => {
  it("renders languages, instruction, and tone into the system prompt", () => {
    const spec = store.resolve(
      req({ text: "hello", target_language: "French", tone: "casual", profile: "general" }),
    );
    const chat = buildChatRequest(spec);
    const system = chat.messages[0].content;
    expect(chat.messages[0].role).toBe("system");
    expect(system).toContain("French");
    expect(system).toContain("You are a translator.");
    expect(system).toContain("casual");
    expect(chat.messages[1].role).toBe("user");
    expect(chat.messages[1].content).toBe("hello");
  });

  it("renders the glossary", () => {
    const spec = store.resolve(
      req({
        text: "hello",
        profile: "general",
        glossary: [{ source: "cat", target: "neko", note: "animal" }],
      }),
    );
    const system = buildChatRequest(spec).messages[0].content;
    expect(system).toContain("cat → neko");
    expect(system).toContain("animal");
  });

  it("flows sampling into the request", () => {
    const spec = store.resolve(req({ text: "hi", temperature: 0.7, max_tokens: 42 }));
    const chat = buildChatRequest(spec);
    expect(chat.sampling.temperature).toBe(0.7);
    expect(chat.sampling.maxTokens).toBe(42);
  });

  it("extracts the translation between delimiters", () => {
    const spec = store.resolve(req({ text: "hi", profile: "general" }));
    expect(extractTranslation("Sure!\n[[hola]] trailing", spec)).toBe("hola");
  });

  it("falls back to the trimmed reply when delimiters are absent", () => {
    const spec = store.resolve(req({ text: "hi", profile: "general" }));
    expect(extractTranslation("  plain text  ", spec)).toBe("plain text");
  });

  it("leaves a literal {name} placeholder intact when rendering", () => {
    const spec = store.resolve(
      req({ text: "hi", instruction: "Preserve {placeholders} exactly." }),
    );
    expect(buildChatRequest(spec).messages[0].content).toContain("{placeholders}");
  });

  it("puts reasoning into the request extra", () => {
    const spec = store.resolve(req({ text: "hi", reasoning_effort: "medium" }));
    expect(buildChatRequest(spec).sampling.extra?.reasoning).toEqual({ effort: "medium" });
  });

  it("omits reasoning when unset", () => {
    const spec = store.resolve(req({ text: "hi" }));
    expect(buildChatRequest(spec).sampling.extra?.reasoning).toBeUndefined();
  });
});
