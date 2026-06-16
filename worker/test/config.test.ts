import { describe, expect, it } from "vitest";

import { ConfigStore } from "../src/config";
import { ConfigError, InvalidRequestError } from "../src/errors";
import { TranslateRequestSchema } from "../src/schemas";
import { makeStore, req } from "./helpers";

describe("ConfigStore.resolve", () => {
  it("applies defaults for a bare request", () => {
    const spec = makeStore().resolve(req({ text: "hello" }));
    expect(spec.model).toBe("google/gemini-2.5-flash");
    expect(spec.targetLanguage).toBe("Spanish");
    expect(spec.sourceLanguage).toBe("auto");
    expect(spec.instruction).toBe("You are a translator.");
    expect(spec.profile.name).toBe("gemini"); // google/* mapping
    expect(spec.temperature).toBe(0.4);
  });

  it("selects the mapped profile from a model override", () => {
    const spec = makeStore().resolve(
      req({ text: "hi", model: "anthropic/claude-haiku-4.5" }),
    );
    expect(spec.profile.name).toBe("claude");
    expect(spec.temperature).toBe(0.2);
  });

  it("lets an explicit profile beat the model mapping", () => {
    const spec = makeStore().resolve(
      req({ text: "hi", model: "anthropic/claude-haiku-4.5", profile: "general" }),
    );
    expect(spec.profile.name).toBe("general");
  });

  it("falls back to the default profile for an unmapped model", () => {
    const spec = makeStore().resolve(req({ text: "hi", model: "meta/llama-3" }));
    expect(spec.profile.name).toBe("general");
  });

  it("appends instruction by default", () => {
    const spec = makeStore().resolve(req({ text: "hi", instruction: "Keep it formal." }));
    expect(spec.instruction).toBe("You are a translator.\n\nKeep it formal.");
  });

  it("replaces instruction in replace mode", () => {
    const spec = makeStore().resolve(
      req({ text: "hi", instruction: "Only slang.", instruction_mode: "replace" }),
    );
    expect(spec.instruction).toBe("Only slang.");
  });

  it("rejects an invalid instruction_mode at the schema", () => {
    const parsed = TranslateRequestSchema.safeParse({
      text: "hi",
      instruction: "x",
      instruction_mode: "prepend",
    });
    expect(parsed.success).toBe(false);
  });

  it("lets sampling overrides beat the profile", () => {
    const spec = makeStore().resolve(req({ text: "hi", temperature: 0.9, max_tokens: 512 }));
    expect(spec.temperature).toBe(0.9);
    expect(spec.maxTokens).toBe(512);
  });

  it("throws on an unknown profile", () => {
    expect(() => makeStore().resolve(req({ text: "hi", profile: "nope" }))).toThrow(
      InvalidRequestError,
    );
  });

  it("merges extra_params: request wins over profile", () => {
    const store = makeStore({
      defaultProfile: "general",
      defaultStreamProfile: "general",
      modelProfileMap: {},
      profiles: {
        general: {
          systemTemplate: "{instruction}",
          extraParams: { provider: { order: ["a"] }, keep: 1 },
        },
      },
    });
    const spec = store.resolve(
      req({ text: "hi", extra_params: { provider: { order: ["b"] } } }),
    );
    expect(spec.extraParams.keep).toBe(1);
    expect(spec.extraParams.provider).toEqual({ order: ["b"] });
  });

  it("rejects a bad default profile at construction", () => {
    expect(() => makeStore({ defaultProfile: "nope" })).toThrow(ConfigError);
  });

  it("loads the real bundled config and resolves", () => {
    const store = new ConfigStore();
    const spec = store.resolve(req({ text: "hi" }));
    expect(spec.model).toBe("google/gemini-3.1-flash-lite");
    const pub = store.publicConfig();
    expect(pub.default_model).toBe(spec.model);
    expect(pub.profiles.some((p) => p.name === "general")).toBe(true);
    expect(pub.reasoning_efforts).toContain("high");
  });
});

describe("reasoning resolution", () => {
  it("is undefined when unset", () => {
    expect(makeStore().resolve(req({ text: "hi" })).reasoning).toBeUndefined();
  });

  it("resolves reasoning_effort", () => {
    expect(makeStore().resolve(req({ text: "hi", reasoning_effort: "high" })).reasoning).toEqual({
      effort: "high",
    });
  });

  it("merges a reasoning object with effort (effort wins)", () => {
    const spec = makeStore().resolve(
      req({ text: "hi", reasoning: { max_tokens: 500 }, reasoning_effort: "low" }),
    );
    expect(spec.reasoning).toEqual({ max_tokens: 500, effort: "low" });
  });

  it("throws on an invalid effort", () => {
    expect(() =>
      makeStore().resolve(req({ text: "hi", reasoning_effort: "ultra" })),
    ).toThrow(InvalidRequestError);
  });

  it("applies a profile default and lets the request override it", () => {
    const store = makeStore({
      defaultProfile: "general",
      defaultStreamProfile: "general",
      modelProfileMap: {},
      profiles: {
        general: { systemTemplate: "{instruction}", reasoning: { effort: "low" } },
      },
    });
    expect(store.resolve(req({ text: "hi" })).reasoning).toEqual({ effort: "low" });
    expect(store.resolve(req({ text: "hi", reasoning_effort: "high" })).reasoning).toEqual({
      effort: "high",
    });
  });
});
