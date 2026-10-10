// @vitest-environment happy-dom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationMenuBar } from "../../src/renderer/ApplicationMenuBar";
import type { RendererMenuInvokeTarget } from "../../src/renderer/applicationMenuProjection";
import { editorCommandIds } from "../../src/shared/commandIds";
import { t, type Language } from "../../src/shared/i18n";

/**
 * #784: Assist > Syntax Check items are checkable. The bar draws whatever
 * `isChecked` says (the App derives it from the toolbar's own state) and
 * invokes the existing command id; it never flips anything itself.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function mount(props: {
  language?: Language;
  checked?: Record<string, boolean>;
  onInvoke?: (target: RendererMenuInvokeTarget) => void;
}): void {
  const language = props.language ?? "en";
  const checked = props.checked ?? {};
  act(() => {
    root.render(
      <ApplicationMenuBar
        platform="windows"
        translate={(key, values) => t(language, key, values)}
        onInvoke={props.onInvoke}
        isChecked={(commandId) => checked[commandId] ?? false}
      />
    );
  });
}

const click = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const hover = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
const item = (label: string): HTMLElement =>
  Array.from(
    container.querySelectorAll<HTMLElement>(".applicationMenuItem")
  ).find(
    (candidate) =>
      candidate.querySelector(":scope > .applicationMenuItemLabel")
        ?.textContent === label
  )!;

function openSyntaxCheck(language: Language = "en"): void {
  const assist = language === "en" ? "Assist" : "アシスト(A)";
  const syntax = language === "en" ? "Syntax Check" : "構文チェック";
  click(
    Array.from(
      container.querySelectorAll<HTMLButtonElement>(".applicationMenuBarItem")
    ).find((button) => button.textContent === assist)!
  );
  hover(item(syntax));
  click(item(syntax));
}

describe("checkable Syntax Check items in the Renderer menu (#784)", () => {
  it("draws menuitemcheckbox with aria-checked taken from isChecked", () => {
    mount({ checked: { [editorCommandIds.toggleSyntaxChecker]: true } });
    openSyntaxCheck();

    const markdown = item("Markdown Syntax Check");
    const instant = item("Instant Japanese Style Check");

    expect(markdown.getAttribute("role")).toBe("menuitemcheckbox");
    expect(markdown.getAttribute("aria-checked")).toBe("true");
    expect(instant.getAttribute("role")).toBe("menuitemcheckbox");
    expect(instant.getAttribute("aria-checked")).toBe("false");
  });

  it("follows a state change (e.g. an automatic OFF) on the next render", () => {
    mount({ checked: { [editorCommandIds.toggleInstantJapaneseLint]: true } });
    openSyntaxCheck();
    expect(
      item("Instant Japanese Style Check").getAttribute("aria-checked")
    ).toBe("true");

    mount({ checked: { [editorCommandIds.toggleInstantJapaneseLint]: false } });

    expect(
      item("Instant Japanese Style Check").getAttribute("aria-checked")
    ).toBe("false");
  });

  it("a click invokes the existing command id; the bar flips nothing itself", () => {
    const onInvoke = vi.fn();
    mount({ onInvoke });
    openSyntaxCheck();

    click(item("Instant Japanese Style Check"));

    expect(onInvoke).toHaveBeenCalledWith({
      type: "command",
      commandId: editorCommandIds.toggleInstantJapaneseLint
    });
    expect(
      item("Instant Japanese Style Check")?.getAttribute("aria-checked") ??
        "false"
    ).toBe("false");
  });

  it("non-checkable items keep role menuitem without aria-checked", () => {
    mount({});
    openSyntaxCheck();

    const other = item("Line Ending Distribution...");

    expect(other.getAttribute("role")).toBe("menuitem");
    expect(other.hasAttribute("aria-checked")).toBe(false);
  });

  it("is labelled in Japanese", () => {
    mount({ language: "ja" });
    openSyntaxCheck("ja");

    expect(item("Markdown構文チェック")).toBeTruthy();
    expect(item("インスタント日本語表現チェック")).toBeTruthy();
  });

  it("keyboard: ArrowDown / Right reach the submenu and Enter invokes the command", () => {
    const onInvoke = vi.fn();
    mount({ onInvoke });
    const editor = document.createElement("input");
    document.body.appendChild(editor);
    editor.focus();
    const press = (keyName: string, altKey = false) =>
      act(() => {
        const event = new KeyboardEvent("keydown", {
          key: keyName,
          altKey,
          bubbles: true,
          cancelable: true
        });
        // happy-dom reports AltGraph whenever Alt is down; a real browser only
        // does for AltGr (same model as ApplicationMenuBarKeyboard.test).
        Object.defineProperty(event, "getModifierState", {
          value: (name: string) => name === "Alt" && altKey
        });
        (document.activeElement ?? document.body).dispatchEvent(event);
      });
    const focusedLabel = () =>
      (document.activeElement as HTMLElement | null)
        ?.querySelector(":scope > .applicationMenuItemLabel")
        ?.textContent;

    press("a", true);
    for (let guard = 0; guard < 20 && focusedLabel() !== "Syntax Check"; guard += 1) {
      press("ArrowDown");
    }
    expect(focusedLabel()).toBe("Syntax Check");

    press("ArrowRight");
    expect(focusedLabel()).toBe("Markdown Syntax Check");
    press("ArrowDown");
    expect(focusedLabel()).toBe("Instant Japanese Style Check");
    press("Enter");

    expect(onInvoke).toHaveBeenCalledWith({
      type: "command",
      commandId: editorCommandIds.toggleInstantJapaneseLint
    });
  });
});
