// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogMessage } from "../../src/renderer/dialog/DialogMessage";
import type {
  AppConfirmDialogOptions,
  AppConfirmDialogResult
} from "../../src/renderer/dialog/appDialogTypes";
import { openManualWithConfirmation } from "../../src/renderer/manualOpen";
import {
  createApplicationCommandTitles,
  createApplicationCommands
} from "../../src/renderer/applicationCommands";
import { CommandRegistry } from "../../src/shared/commandRegistry";
import { applicationCommandIds } from "../../src/shared/commandIds";
import { getApplicationMenuModel } from "../../src/shared/applicationMenuModel";
import { MANUAL_URLS, manualUrlForLanguage } from "../../src/shared/manualUrl";
import {
  languageDefinitions,
  t,
  type Language,
  type TranslationKey,
  type TranslationValues
} from "../../src/shared/i18n";
import { parseExternalHttpUrl } from "../../src/shared/externalHttpUrl";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const translateFor =
  (language: Language) => (key: TranslationKey, values?: TranslationValues) =>
    t(language, key, values);

describe("manual URL resolver (#737)", () => {
  it("maps each UI language to its fixed manual URL", () => {
    expect(manualUrlForLanguage("ja")).toBe("https://pergamum-ide.github.io/ja/");
    expect(manualUrlForLanguage("en")).toBe("https://pergamum-ide.github.io/en/");
  });

  it("covers exactly the supported languages (languageDefinitions)", () => {
    expect(Object.keys(MANUAL_URLS).sort()).toEqual(
      Object.keys(languageDefinitions).sort()
    );
    for (const language of Object.keys(languageDefinitions) as Language[]) {
      expect(manualUrlForLanguage(language)).toMatch(/^https:\/\/.+\/$/);
    }
  });

  it("every manual URL passes the main-process external URL validation", () => {
    for (const url of Object.values(MANUAL_URLS)) {
      expect(parseExternalHttpUrl(url)).not.toBeNull();
    }
  });

  it("does not consult the browser or OS locale", () => {
    // Code only: the doc comment names Accept-Language to say it is NOT used.
    const code = readFileSync("src/shared/manualUrl.ts", "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/navigator|Accept-Language|Intl\.|\.language/);
  });
});

describe("help.manual command (#737)", () => {
  function registry(language: Language, openManual = vi.fn()) {
    const noop = () => undefined;
    const commandRegistry = new CommandRegistry();
    for (const command of createApplicationCommands(
      new Proxy({ openManual } as Record<string, unknown>, {
        get: (target, key) => (key in target ? target[key as string] : noop)
      }) as never,
      createApplicationCommandTitles(translateFor(language) as never)
    )) {
      commandRegistry.register(command as never);
    }
    return { commandRegistry, openManual };
  }

  it("is a help command with a JA / EN title and description and no shortcut", () => {
    expect(applicationCommandIds.openManual).toBe("help.manual");
    const ja = registry("ja").commandRegistry.get(applicationCommandIds.openManual)!;
    const en = registry("en").commandRegistry.get(applicationCommandIds.openManual)!;

    expect(ja.title).toBe("マニュアル");
    expect(en.title).toBe("Manual");
    expect(ja.description).toBeTruthy();
    expect(en.description).toBeTruthy();
    expect(ja.category).toBe("help");
    expect(readFileSync("src/shared/keybindings/defaults.ts", "utf8")).not.toContain(
      "help.manual"
    );
  });

  it("sorts between Usage Tour and Markdown Cheat Sheet, before About", () => {
    const { commandRegistry } = registry("ja");
    const order = (id: string) =>
      commandRegistry.get(id as never)!.paletteOrder!;

    expect(order(applicationCommandIds.openUsageTour)).toBeLessThan(
      order(applicationCommandIds.openManual)
    );
    expect(order(applicationCommandIds.openManual)).toBeLessThan(
      order(applicationCommandIds.openMarkdownCheatSheet)
    );
    expect(order(applicationCommandIds.openMarkdownCheatSheet)).toBeLessThan(
      order(applicationCommandIds.openAbout)
    );
  });

  it("executing the command only asks the controller (it never opens a browser itself)", async () => {
    const { commandRegistry, openManual } = registry("ja");
    await commandRegistry.execute(applicationCommandIds.openManual, {
      source: "commandPalette"
    });

    expect(openManual).toHaveBeenCalledTimes(1);
  });
});

describe("Help menu (#737)", () => {
  it("lists Manual between Usage Tour and Markdown Cheat Sheet on every platform", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      const help = getApplicationMenuModel(platform).find(
        (item) => item.role === "help"
      )!;
      const ids = help.items.map((item) =>
        item.type === "command" ? item.commandId : item.type
      );

      expect(ids.indexOf(applicationCommandIds.openManual)).toBe(
        ids.indexOf(applicationCommandIds.openUsageTour) + 1
      );
      expect(ids.indexOf(applicationCommandIds.openMarkdownCheatSheet)).toBe(
        ids.indexOf(applicationCommandIds.openManual) + 1
      );
    }
    expect(t("ja", "menu.manual")).toBe("マニュアル");
    expect(t("en", "menu.manual")).toBe("Manual");
  });
});

describe("manual confirmation flow (#737)", () => {
  function run(language: Language, answer: AppConfirmDialogResult) {
    const calls: AppConfirmDialogOptions[] = [];
    const openExternalUrl = vi.fn(async () => undefined);
    const confirmDialog = vi.fn(async (options: AppConfirmDialogOptions) => {
      calls.push(options);
      return answer;
    });
    const done = openManualWithConfirmation({
      language,
      translate: translateFor(language),
      confirmDialog,
      openExternalUrl
    });
    return { done, calls, openExternalUrl, confirmDialog };
  }

  it("asks first: nothing is opened until the dialog resolves", async () => {
    let resolveDialog!: (value: AppConfirmDialogResult) => void;
    const openExternalUrl = vi.fn(async () => undefined);
    const done = openManualWithConfirmation({
      language: "ja",
      translate: translateFor("ja"),
      confirmDialog: () =>
        new Promise<AppConfirmDialogResult>((resolve) => {
          resolveDialog = resolve;
        }),
      openExternalUrl
    });

    expect(openExternalUrl).not.toHaveBeenCalled();
    resolveDialog("confirm");
    await done;
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["ja", "マニュアルを開く", "以下のマニュアルURLをブラウザで開きます。よろしいですか？", "はい", "キャンセル", "https://pergamum-ide.github.io/ja/"],
    ["en", "Open Manual", "Open the following manual URL in your browser?", "Yes", "Cancel", "https://pergamum-ide.github.io/en/"]
  ] as const)(
    "%s dialog: title, message, URL row and buttons",
    async (language, title, message, yes, cancel, url) => {
      const { done, calls } = run(language, "cancel");
      await done;

      expect(calls).toHaveLength(1);
      expect(calls[0].title).toBe(title);
      expect(calls[0].message).toEqual({
        kind: "plainTextWithUrlRow",
        beforeText: message,
        url
      });
      expect(calls[0].confirmLabel).toBe(yes);
      expect(calls[0].cancelLabel).toBe(cancel);
      expect(calls[0].icon?.kind).toBe("externalLink");
    }
  );

  it.each([
    ["ja", "https://pergamum-ide.github.io/ja/"],
    ["en", "https://pergamum-ide.github.io/en/"]
  ] as const)("Yes opens the %s URL through the existing openExternalUrl path", async (language, url) => {
    const { done, openExternalUrl } = run(language, "confirm");
    await done;

    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).toHaveBeenCalledWith(url);
  });

  it("uses the shared Yes label (common.yes) and defines common.no", () => {
    expect(t("ja", "common.yes")).toBe("はい");
    expect(t("en", "common.yes")).toBe("Yes");
    expect(t("ja", "common.no")).toBe("いいえ");
    expect(t("en", "common.no")).toBe("No");
    expect(
      readFileSync("src/renderer/manualOpen.ts", "utf8")
    ).toContain(`translate("common.yes")`);
  });

  it("Cancel and Escape (resolved as cancel) open nothing", async () => {
    const { done, openExternalUrl } = run("ja", "cancel");
    await done;
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it("uses only the sanctioned path: App wires appInfo.openExternalUrl, no window.open / new opener", () => {
    const app = readFileSync("src/renderer/App.tsx", "utf8");
    const helper = readFileSync("src/renderer/manualOpen.ts", "utf8");

    expect(app).toContain("openManualWithConfirmation({");
    expect(app).toContain(
      "openExternalUrl: (url) => window.pergamum.appInfo.openExternalUrl(url)"
    );
    expect(helper).not.toMatch(/window\.open|shell\.|target=|_blank/);
    expect(
      readFileSync("src/shared/manualUrl.ts", "utf8")
    ).not.toMatch(/window\.open|shell\./);
  });
});

describe("manual dialog body: display-only URL row (#737)", () => {
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
  });

  const message = {
    kind: "plainTextWithUrlRow",
    beforeText: "以下のマニュアルURLをブラウザで開きます。よろしいですか？",
    url: "https://pergamum-ide.github.io/ja/"
  } as const;

  it("shows the message, the URL text and the link-external icon", () => {
    act(() => root.render(<DialogMessage id="m" message={message} />));

    expect(container.textContent).toContain(message.beforeText);
    const row = container.querySelector(".appDialogUrlRow")!;
    expect(row.textContent).toBe(message.url);
    const icon = row.querySelector(".appDialogUrlIcon") as HTMLElement;
    expect(icon).not.toBeNull();
    // The bundled asset is inlined as a data URL, wired through MaskedIcon.
    expect(icon.getAttribute("style")).toContain("--masked-icon-url");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("is not clickable: no anchor, no button, no handlers, no role", () => {
    const markup = renderToStaticMarkup(<DialogMessage id="m" message={message} />);

    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("href=");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("role=");
    expect(markup).not.toContain("tabindex");
    expect(markup).not.toContain("onclick");
  });

  it("clicking the URL or the icon opens nothing and does not leave the page", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const openExternalUrl = vi.fn();
    (window as any).pergamum = { appInfo: { openExternalUrl } };

    act(() => root.render(<DialogMessage id="m" message={message} />));
    for (const selector of [".appDialogUrlRow", ".appDialogUrlText", ".appDialogUrlIcon"]) {
      act(() => {
        container
          .querySelector(selector)!
          .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    }

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    delete (window as any).pergamum;
    openSpy.mockRestore();
  });

  it("uses the codicons link-external.svg asset", () => {
    expect(readFileSync("src/renderer/dialog/DialogMessage.tsx", "utf8")).toContain(
      "assets/icons/codicons/dialog/link-external.svg?url"
    );
  });
});
