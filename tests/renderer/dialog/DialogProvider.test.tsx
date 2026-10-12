import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t, type Translate } from "../../../src/shared/i18n";
import { DialogProvider } from "../../../src/renderer/dialog/DialogProvider";

const translate: Translate = (key, values) => t("ja", key, values);

describe("DialogProvider (#182)", () => {
  it("renders its children", () => {
    const markup = renderToStaticMarkup(
      React.createElement(DialogProvider, {
        translate,
        children: React.createElement(
          "div",
          { className: "harnessChild" },
          "child"
        )
      })
    );

    expect(markup).toContain("harnessChild");
  });

  it("does not render a confirm dialog until confirm() is called (no pending request initially)", () => {
    const markup = renderToStaticMarkup(
      React.createElement(DialogProvider, {
        translate,
        children: React.createElement("div", null, "child")
      })
    );

    expect(markup).not.toContain("appDialogBackdrop");
    expect(markup).not.toContain('role="dialog"');
  });

  it("exposes choice as a separate dialog API and renders pending choice requests separately", () => {
    const source = readFileSync("src/renderer/dialog/DialogProvider.tsx", "utf8");

    expect(source).toContain(
      "choice(options: AppChoiceDialogOptions): Promise<AppChoiceDialogResult>"
    );
    expect(source).toContain('pending?.kind === "confirm"');
    expect(source).toContain('pending?.kind === "choice"');
    expect(source).toContain("<ChoiceDialog");
  });

  it("plays optional dialog display sound from both confirm and choice request boundaries (#200)", () => {
    const source = readFileSync("src/renderer/dialog/DialogProvider.tsx", "utf8");

    expect(source).toContain("soundFeedback?: SoundFeedbackPlayer");
    expect(source).toContain("soundSettings?: WorkbenchSoundSettings");
    expect(source.match(/playDialogShownSound\(soundFeedback, soundSettings\)/g)).toHaveLength(2);
  });
});
