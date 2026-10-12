import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../../src/renderer/dialog/ConfirmDialog";
import type { AppConfirmDialogOptions } from "../../../src/renderer/dialog/appDialogTypes";
import {
  handleConfirmDialogBackdropClick,
  handleConfirmDialogKeyDown
} from "../../../src/renderer/dialog/confirmDialogHandlers";

describe("handleConfirmDialogBackdropClick (#182 D-17 / #184 follow-up)", () => {
  it('resolves "cancel" when dismissOnBackdropClick is true', () => {
    const onResult = vi.fn();

    handleConfirmDialogBackdropClick(onResult, true);

    expect(onResult).toHaveBeenCalledWith("cancel");
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("does not call onResult when dismissOnBackdropClick is false", () => {
    const onResult = vi.fn();

    handleConfirmDialogBackdropClick(onResult, false);

    expect(onResult).not.toHaveBeenCalled();
  });
});

describe("handleConfirmDialogKeyDown (#182 D-15)", () => {
  it('Escape resolves "cancel"', () => {
    const onResult = vi.fn();

    handleConfirmDialogKeyDown({ key: "Escape" }, onResult);

    expect(onResult).toHaveBeenCalledWith("cancel");
  });

  it('Escape calls onResult("cancel") exactly once', () => {
    const onResult = vi.fn();

    handleConfirmDialogKeyDown({ key: "Escape" }, onResult);

    expect(onResult).toHaveBeenCalledWith("cancel");
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("Escape returns true", () => {
    const onResult = vi.fn();

    const handled = handleConfirmDialogKeyDown({ key: "Escape" }, onResult);

    expect(handled).toBe(true);
  });

  it("Enter does not resolve anything (no implicit dialog-wide Enter=confirm handler) and returns false", () => {
    const onResult = vi.fn();

    const handled = handleConfirmDialogKeyDown({ key: "Enter" }, onResult);

    expect(onResult).not.toHaveBeenCalled();
    expect(handled).toBe(false);
  });

  it("Space does not resolve anything (left to native focused button activation) and returns false", () => {
    const onResult = vi.fn();

    const handled = handleConfirmDialogKeyDown({ key: " " }, onResult);

    expect(onResult).not.toHaveBeenCalled();
    expect(handled).toBe(false);
  });

  it("Tab does not resolve anything (handled separately by the focus trap) and returns false", () => {
    const onResult = vi.fn();

    const handled = handleConfirmDialogKeyDown({ key: "Tab" }, onResult);

    expect(onResult).not.toHaveBeenCalled();
    expect(handled).toBe(false);
  });

  it("an unrelated key does not resolve anything and returns false", () => {
    const onResult = vi.fn();

    const handled = handleConfirmDialogKeyDown({ key: "a" }, onResult);

    expect(onResult).not.toHaveBeenCalled();
    expect(handled).toBe(false);
  });
});

describe("ConfirmDialog action button ordering (#801)", () => {
  const dummyClipboard = {
    readText: async () => "",
    writeText: async () => undefined
  };

  const baseOptions: AppConfirmDialogOptions = {
    title: "Test Dialog",
    message: { kind: "plainText", text: "Message" },
    icon: { kind: "externalLink", tooltip: "Link" },
    clipboardText: null,
    confirmLabel: "開く",
    cancelLabel: "キャンセル"
  };

  it("always renders cancel before confirm (#802)", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ConfirmDialog, {
        options: baseOptions,
        translate: (k) => k,
        clipboardAdapter: dummyClipboard,
        opener: null,
        onResult: () => undefined
      })
    );

    const confirmIndex = markup.indexOf("appDialogButton-confirm");
    const cancelIndex = markup.indexOf("appDialogButton-cancel");

    // Left: cancel, Right: confirm (cancel appears first in DOM order)
    expect(cancelIndex).toBeLessThan(confirmIndex);
  });
});
