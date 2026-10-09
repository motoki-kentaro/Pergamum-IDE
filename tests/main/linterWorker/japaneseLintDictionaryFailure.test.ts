import { describe, expect, it } from "vitest";
import { isJapaneseLintDictionaryMissing, JapaneseLintWorkerError } from "../../../src/main/linterWorker/japaneseLintHost";

describe("dictionary failure identity (#775)", () => {
  it("accepts only a typed dictionary-missing Worker response", () => {
    expect(isJapaneseLintDictionaryMissing(new JapaneseLintWorkerError("worker-error", {
      kind: "dictionary-missing", name: "Error", stack: []
    }))).toBe(true);
    for (const value of [
      new Error("dictionary-missing"),
      { kind: "worker-error", workerError: { kind: "dictionary-missing" } },
      new JapaneseLintWorkerError("worker-error", { kind: "lint-failed", name: "Error", stack: [] }),
      new JapaneseLintWorkerError("timeout"),
      undefined
    ]) {
      expect(isJapaneseLintDictionaryMissing(value)).toBe(false);
    }
  });
});
