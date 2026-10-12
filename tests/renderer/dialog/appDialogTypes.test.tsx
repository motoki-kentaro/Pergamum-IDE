import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AppDialogError,
  choiceDialogDismissesOnBackdropClick,
  confirmDialogDismissesOnBackdropClick,
  resolveCancelChoiceId,
  resolveChoiceDialogActionOrder,
  resolveChoiceDialogActionOrderPolicy,
  resolveInitialFocusChoiceId,
  resolvePrimaryChoiceId,
  validateChoiceDialogOptions,
  type AppChoiceDialogOptions,
  type AppConfirmDialogOptions,
  type AppConfirmDialogResult
} from "../../../src/renderer/dialog/appDialogTypes";

function baseOptions(): AppConfirmDialogOptions {
  return {
    title: "Title",
    message: { kind: "plainText", text: "Message" },
    icon: null,
    clipboardText: null
  };
}

function dirtyCloseChoiceOptions(
  overrides: Partial<AppChoiceDialogOptions> = {}
): AppChoiceDialogOptions {
  return {
    title: "Unsaved Changes",
    message: { kind: "plainText", text: "Choose how to close." },
    icon: { kind: "warning", tooltip: "Warning" },
    choices: [
      { id: "save", label: "Save", role: "primary" },
      { id: "discard", label: "Don't Save", role: "destructive" },
      { id: "cancel", label: "Cancel", role: "cancel" }
    ],
    primaryChoiceId: "save",
    cancelChoiceId: "cancel",
    clipboardText: null,
    ...overrides
  };
}

type IsExact<TActual, TExpected> =
  (<T>() => T extends TActual ? 1 : 2) extends
  <T>() => T extends TExpected ? 1 : 2
    ? (<T>() => T extends TExpected ? 1 : 2) extends
        <T>() => T extends TActual ? 1 : 2
      ? true
      : false
    : false;

describe("AppDialogError (#182 D-14)", () => {
  it("carries the dialogAlreadyOpen kind", () => {
    const error = new AppDialogError("dialogAlreadyOpen");

    expect(error.kind).toBe("dialogAlreadyOpen");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("AppConfirmDialogResult (#192 confirm remains binary)", () => {
  it('remains exactly "confirm" | "cancel"', () => {
    const isBinary: IsExact<
      AppConfirmDialogResult,
      "confirm" | "cancel"
    > = true;

    expect(isBinary).toBe(true);
  });
});

describe("confirmDialogDismissesOnBackdropClick (#184 follow-up)", () => {
  it("defaults to true when dismissOnBackdropClick is omitted (existing call sites keep their current behavior)", () => {
    expect(confirmDialogDismissesOnBackdropClick(baseOptions())).toBe(true);
  });

  it("is true when dismissOnBackdropClick is explicitly true", () => {
    expect(
      confirmDialogDismissesOnBackdropClick({
        ...baseOptions(),
        dismissOnBackdropClick: true
      })
    ).toBe(true);
  });

  it("is false when dismissOnBackdropClick is explicitly false", () => {
    expect(
      confirmDialogDismissesOnBackdropClick({
        ...baseOptions(),
        dismissOnBackdropClick: false
      })
    ).toBe(false);
  });
});

describe("choice dialog option validation (#192)", () => {
  it("rejects an empty choices array", () => {
    expect(() =>
      validateChoiceDialogOptions(dirtyCloseChoiceOptions({ choices: [] }))
    ).toThrow(AppDialogError);
  });

  it("rejects duplicate choice ids", () => {
    expect(() =>
      validateChoiceDialogOptions(
        dirtyCloseChoiceOptions({
          choices: [
            { id: "save", label: "Save", role: "primary" },
            { id: "save", label: "Also Save", role: "neutral" }
          ]
        })
      )
    ).toThrow(AppDialogError);
  });

  it.each([
    ["primaryChoiceId", { primaryChoiceId: "missing" }],
    ["cancelChoiceId", { cancelChoiceId: "missing" }],
    ["initialFocusChoiceId", { initialFocusChoiceId: "missing" }]
  ] as const)("rejects an unknown %s reference", (_name, override) => {
    expect(() =>
      validateChoiceDialogOptions(dirtyCloseChoiceOptions(override))
    ).toThrow(AppDialogError);
  });

  it("rejects primaryChoiceId and cancelChoiceId pointing to the same choice", () => {
    let thrown: unknown;

    try {
      validateChoiceDialogOptions(
        dirtyCloseChoiceOptions({
          primaryChoiceId: "save",
          cancelChoiceId: "save"
        })
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppDialogError);
    expect(thrown).toMatchObject({ kind: "invalidChoiceDialogOptions" });
  });
});

describe("choice dialog backdrop behavior (#192)", () => {
  it("defaults to false when dismissOnBackdropClick is omitted", () => {
    expect(choiceDialogDismissesOnBackdropClick(dirtyCloseChoiceOptions())).toBe(
      false
    );
  });

  it("is true only when dismissOnBackdropClick is explicitly true", () => {
    expect(
      choiceDialogDismissesOnBackdropClick(
        dirtyCloseChoiceOptions({ dismissOnBackdropClick: true })
      )
    ).toBe(true);
    expect(
      choiceDialogDismissesOnBackdropClick(
        dirtyCloseChoiceOptions({ dismissOnBackdropClick: false })
      )
    ).toBe(false);
  });
});

describe("choice dialog primary/cancel/focus resolution (#192)", () => {
  it("uses explicit primaryChoiceId before role fallback", () => {
    const options = dirtyCloseChoiceOptions({
      primaryChoiceId: "discard"
    });

    expect(resolvePrimaryChoiceId(options)).toBe("discard");
  });

  it("falls back to the first primary-role choice", () => {
    const options = dirtyCloseChoiceOptions({ primaryChoiceId: undefined });

    expect(resolvePrimaryChoiceId(options)).toBe("save");
  });

  it("uses explicit cancelChoiceId before role fallback", () => {
    const options = dirtyCloseChoiceOptions({
      cancelChoiceId: "discard"
    });

    expect(resolveCancelChoiceId(options)).toBe("discard");
  });

  it("falls back to the first cancel-role choice", () => {
    const options = dirtyCloseChoiceOptions({ cancelChoiceId: undefined });

    expect(resolveCancelChoiceId(options)).toBe("cancel");
  });

  it("honors initialFocusChoiceId independently from primaryChoiceId", () => {
    const options = dirtyCloseChoiceOptions({
      primaryChoiceId: "save",
      initialFocusChoiceId: "cancel"
    });

    expect(resolvePrimaryChoiceId(options)).toBe("save");
    expect(resolveInitialFocusChoiceId(options)).toBe("cancel");
  });

  it("uses cancelChoiceId as default focus when initialFocusChoiceId is omitted", () => {
    expect(resolveInitialFocusChoiceId(dirtyCloseChoiceOptions())).toBe(
      "cancel"
    );
  });

  it("uses the first cancel-role choice when cancelChoiceId is omitted", () => {
    const options = dirtyCloseChoiceOptions({ cancelChoiceId: undefined });

    expect(resolveInitialFocusChoiceId(options)).toBe("cancel");
  });

  it("uses the first non-destructive choice before the first choice", () => {
    const options = dirtyCloseChoiceOptions({
      primaryChoiceId: undefined,
      cancelChoiceId: undefined,
      choices: [
        { id: "discard", label: "Discard", role: "destructive" },
        { id: "review", label: "Review", role: "neutral" }
      ]
    });

    expect(resolveInitialFocusChoiceId(options)).toBe("review");
  });

  it("uses the first choice when every choice is destructive", () => {
    const options = dirtyCloseChoiceOptions({
      primaryChoiceId: undefined,
      cancelChoiceId: undefined,
      choices: [
        { id: "discard", label: "Discard", role: "destructive" },
        { id: "delete", label: "Delete", role: "destructive" }
      ]
    });

    expect(resolveInitialFocusChoiceId(options)).toBe("discard");
  });
});

describe("choice dialog semantic action order (#192)", () => {
  it('defaults actionOrderPolicy to "semantic"', () => {
    expect(resolveChoiceDialogActionOrderPolicy(dirtyCloseChoiceOptions())).toBe(
      "semantic"
    );
  });

  it("orders dirty-close-style choices as save / discard / cancel on every platform", () => {
    for (const platform of ["windows", "linux", "macos", "other"] as const) {
      expect(
        resolveChoiceDialogActionOrder(dirtyCloseChoiceOptions(), platform).map(
          (choice) => choice.id
        )
      ).toEqual(["save", "discard", "cancel"]);
    }
  });

  it("does not carry over horizontal macOS ordering into semantic choice order", () => {
    expect(
      resolveChoiceDialogActionOrder(dirtyCloseChoiceOptions(), "macos").map(
        (choice) => choice.id
      )
    ).not.toEqual(["discard", "cancel", "save"]);
  });

  it("does not implement choice ordering as a simple reverse in the helper", () => {
    const source = readFileSync("src/renderer/dialog/appDialogTypes.ts", "utf8");

    expect(source).not.toContain(".reverse(");
  });

  it("preserves caller-provided order when actionOrderPolicy is caller", () => {
    expect(
      resolveChoiceDialogActionOrder(
        dirtyCloseChoiceOptions({
          actionOrderPolicy: "caller",
          choices: [
            { id: "cancel", label: "Cancel", role: "cancel" },
            { id: "save", label: "Save", role: "primary" },
            { id: "discard", label: "Discard", role: "destructive" }
          ]
        }),
        "macos"
      ).map((choice) => choice.id)
    ).toEqual(["cancel", "save", "discard"]);
  });

  it("preserves relative order among neutral and destructive choices", () => {
    const options = dirtyCloseChoiceOptions({
      choices: [
        { id: "save", label: "Save", role: "primary" },
        { id: "discard", label: "Discard", role: "destructive" },
        { id: "review", label: "Review", role: "neutral" },
        { id: "cancel", label: "Cancel", role: "cancel" }
      ]
    });

    expect(
      resolveChoiceDialogActionOrder(options, "macos").map((choice) => choice.id)
    ).toEqual(["save", "discard", "review", "cancel"]);
  });
});

describe("AppConfirmDialogOptions destructive confirmLabel enforcement (#182 D-10, type-level)", () => {
  it("accepts a default-tone options object without confirmLabel", () => {
    const options: AppConfirmDialogOptions = {
      title: "Title",
      message: { kind: "plainText", text: "Message" },
      icon: null,
      clipboardText: null
    };

    expect(options.tone ?? "default").toBe("default");
  });

  it("accepts a destructive-tone options object that provides confirmLabel", () => {
    const options: AppConfirmDialogOptions = {
      title: "Title",
      message: { kind: "plainText", text: "Message" },
      icon: null,
      clipboardText: null,
      tone: "destructive",
      confirmLabel: "削除"
    };

    expect(options.tone).toBe("destructive");
  });

  it("rejects a destructive-tone options object missing confirmLabel at the type level", () => {
    // @ts-expect-error tone: "destructive" requires a concrete confirmLabel
    const options: AppConfirmDialogOptions = {
      title: "Title",
      message: { kind: "plainText", text: "Message" },
      icon: null,
      clipboardText: null,
      tone: "destructive"
    };

    void options;
  });
});
