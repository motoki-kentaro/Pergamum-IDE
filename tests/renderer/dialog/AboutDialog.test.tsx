import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  APP_INFO_EXTERNAL_LINKS,
  type PergamumAppInfo
} from "../../../src/shared/api";
import { t, type Translate } from "../../../src/shared/i18n";
import {
  AboutDialog,
  aboutCreditsHeading,
  aboutCreditsRows,
  formatAboutTechnicalInformation
} from "../../../src/renderer/dialog/AboutDialog";
import type { ClipboardAdapter } from "../../../src/renderer/dialog/clipboardAdapter";

const translateEn: Translate = (key, values) => t("en", key, values);
const translateJa: Translate = (key, values) => t("ja", key, values);
const noop = () => undefined;
const noopClipboardAdapter: ClipboardAdapter = {
  writeText: () => Promise.resolve()
};
const testAppInfo: PergamumAppInfo = {
  name: "Pergamum",
  version: "9.8.7-test",
  license: "Test-License",
  copyright: "Copyright (c) 2026 Pergamum IDE",
  runtime: {
    electron: "43.4.0-test",
    chromium: "140.0.0-test",
    node: "24.0.0-test",
    v8: "14.0-test",
    osType: "Windows_NT",
    osRelease: "10.0.26100-test",
    platform: "win32",
    arch: "x64"
  }
};

function renderAboutDialog(translate: Translate = translateEn): string {
  return renderToStaticMarkup(
    React.createElement(AboutDialog, {
      appInfo: testAppInfo,
      translate,
      clipboardAdapter: noopClipboardAdapter,
      opener: null,
      onClose: noop,
      onOpenRepository: noop,
      onOpenLegalDocument: noop,
      onShowStaffCredits: noop
    })
  );
}

function cssRuleBlock(styles: string, selector: string): string {
  const start = styles.indexOf(`${selector} {`);

  expect(start).toBeGreaterThan(-1);

  const end = styles.indexOf("}", start);

  expect(end).toBeGreaterThan(start);

  return styles.slice(start, end + 1);
}

function expectDialogHorizontalPaddingVariable(rule: string): void {
  expect(rule).toContain(
    "padding-inline: var(--app-dialog-horizontal-padding)"
  );
  expect(rule).not.toMatch(/\bpadding\s*:\s*[^;]*(?:16px|20px)/);
  expect(rule).not.toMatch(/\bpadding-inline\s*:\s*(?:16px|20px)/);
}

describe("AboutDialog (#221)", () => {
  it("renders app identity, runtime app info, repository guidance, and the third-party notices link", () => {
    const markup = renderAboutDialog();

    expect(markup).toContain("aboutDialogAppIcon");
    expect(markup).toContain("Pergamum app icon");
    expect(markup).toContain("aboutDialogAppIconButton");
    expect(markup).toContain('aria-label="Show staff credits"');
    expect(markup).toContain("aboutDialogLogo");
    expect(markup).toContain("Pergamum logo");
    expect(markup).toContain("appInfoDialogHiddenTitle");
    expect(markup).toContain(">About Pergamum<");
    expect(markup).not.toContain("appDialogHeader appInfoDialogHeader");
    expect(markup).not.toContain("aboutDialogAppName");
    expect(markup).toContain("IDE for novelists");
    expect(markup).toContain("Version:");
    expect(markup).toContain("9.8.7-test");
    expect(markup).toContain("License:");
    expect(markup).toContain("Test-License");
    expect(markup).toContain("Copyright:");
    expect(markup).toContain("Copyright (c) 2026 Pergamum IDE");
    expect(markup).toContain("Repository:");
    expect(markup).toContain("Pergamum-IDE/Pergamum-IDE");
    expect(markup).toContain(APP_INFO_EXTERNAL_LINKS.repository);
    expect(markup).toContain("aboutDialogExternalLinkIcon");
    expect(markup).not.toContain("(Open on GitHub)");
    expect(markup).toContain("Third-party notices:");
    expect(markup).toContain("This application uses open-source software.");
    // #432: the dedicated typewriter-sounds acknowledgement is gone; instead a
    // single link opens the aggregated THIRD_PARTY_NOTICES.md externally.
    expect(markup).not.toContain("Credits:");
    expect(markup).not.toContain("Typewriter sounds:");
    expect(markup).not.toContain("Cassie-OrbitGames");
    expect(markup).not.toContain("OpenGameArt");
    expect(markup).not.toContain(
      "Third-party license notices will be included with the distribution or repository."
    );
    expect(markup).toContain("Third-party licenses");
    expect(markup).toContain("Third-party notices<");
    // #627: legal documents open from the installed app, never from GitHub.
    expect(markup).not.toContain("THIRD_PARTY_NOTICES.md");
    expect(markup).not.toContain("THIRD_PARTY_LICENSES.md");
    expect(markup).not.toContain("/blob/main/");
    expect(markup).toContain('aria-label="Copy technical information"');
    expect(markup).toContain('title="Copy technical information"');
    expect(markup).not.toContain(">Copy technical information<");
    expect(markup).toContain("aboutDialogCopyTechnicalIcon");
    expect(markup).not.toContain("aboutDialogCopyToast");
    expect(markup).not.toContain("Electron version:");
    expect(markup).not.toContain("Chromium version:");
    expect(markup).not.toContain("Node.js version:");
  });

  it("uses InfoDialog and fixed action callbacks instead of href URLs or Markdown", () => {
    const source = readFileSync(
      "src/renderer/dialog/AboutDialog.tsx",
      "utf8"
    );

    expect(source).toContain("<InfoDialog");
    expect(source).toContain("../../../assets/logo/logo-mono.svg?url");
    expect(source).toContain("assets/icons/feather/dialog/check-square.svg?url");
    expect(source).toContain("assets/icons/feather/dialog/clipboard.svg?url");
    expect(source).toContain("assets/icons/feather/dialog/external-link.svg?url");
    expect(source).toContain("assets/icons/feather/dialog/x-circle.svg?url");
    expect(source).toContain("performClipboardCopy");
    expect(source).toContain("TECHNICAL_INFO_COPY_FEEDBACK_FADE_MS = 1500");
    expect(source).toContain("TECHNICAL_INFO_COPY_FEEDBACK_TOTAL_MS");
    expect(source).toContain("clearTimeout");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).not.toContain('className="appDialogButtonLabel"');
    expect(source).toContain("onOpenRepository");
    expect(source).toContain("onOpenLegalDocument");
    expect(source).toContain("onShowStaffCredits");
    expect(source).toContain('kind: "anchorRect"');
    expect(source).toContain("getBoundingClientRect");
    expect((source.match(/\{"\\u00a0"\}/g) ?? []).length).toBe(1);
    // #432 follow-up: the historical typewriter-sounds names are fully gone.
    expect(source).not.toContain("TypewriterSoundsCredit");
    expect(source).not.toContain("typewriterCredit");
    expect(source).not.toContain(["assets/logo", ".png"].join(""));
    expect(source).not.toContain("href=");
    expect(source).not.toContain("Markdown");
    expect(source).not.toContain("navigator.clipboard");
    expect(source).not.toContain("openExternal");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });

  it("keeps hidden staff credits as structured plain text rows, using the runtime app version", () => {
    expect(aboutCreditsHeading(testAppInfo)).toBe(
      "Pergamum Ver.9.8.7-test : Staff Credit"
    );
    expect(aboutCreditsRows()).toEqual([
      { label: "AI Conductor / Product Owner", value: "Kentaro Motoki" },
      { label: "System Architect", value: "ChatGPT" },
      { label: "Reviewers", value: "Claude, Gemini" },
      { label: "Programmers", value: "Claude Code, Codex, Antigravity" },
      { label: "Special Thanks", value: "My Friends" },
      { label: "Gopher / Dogfood Tester", value: "Kentaro Motoki" }
    ]);
  });

  it("#627: makes the license value a link to the bundled LICENSE", () => {
    const markup = renderAboutDialog();
    const licenseRow = markup.slice(markup.indexOf("License:"), markup.indexOf("Copyright:"));

    expect(licenseRow).toContain("aboutDialogLinkButton");
    expect(licenseRow).toContain('aria-label="Open the Pergamum license"');
    expect(licenseRow).toContain(">Test-License</button>");
  });

  it("#627: renders the two legal document links in the Third-party notices section, and no Credits section", () => {
    const markup = renderAboutDialog();
    const thirdPartyStart = markup.indexOf("Third-party notices:");
    const copyControlStart = markup.indexOf("aboutDialogTechnicalInfoControl");

    expect(thirdPartyStart).toBeGreaterThan(-1);
    expect(copyControlStart).toBeGreaterThan(thirdPartyStart);

    const thirdPartySectionMarkup = markup.slice(thirdPartyStart, copyControlStart);

    expect(thirdPartySectionMarkup.match(/aboutDialogLinkButton/g)).toHaveLength(2);
    expect(thirdPartySectionMarkup).toContain(">Third-party licenses</button>");
    expect(thirdPartySectionMarkup).toContain(">Third-party notices</button>");
    expect(thirdPartySectionMarkup).not.toContain("aboutDialogExternalLinkIcon");
    expect(markup).not.toContain("Credits:");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
  });

  it("#627: uses the Japanese labels decided for the legal links", () => {
    const markup = renderAboutDialog(translateJa);

    expect(markup).toContain("ライセンス:");
    expect(markup).toContain("サードパーティ表記:");
    expect(markup).toContain("Pergamum はオープンソースソフトウェアを利用しています。");
    expect(markup).toContain(">サードパーティライセンス</button>");
    expect(markup).toContain(">サードパーティ通知</button>");
  });

  it("#627: routes legal links through fixed document ids, and keeps the repository link external", () => {
    const source = readFileSync("src/renderer/dialog/AboutDialog.tsx", "utf8");

    expect(source).toContain('onOpenLegalDocument("license")');
    expect(source).toContain('onOpenLegalDocument("thirdPartyLicenses")');
    expect(source).toContain('onOpenLegalDocument("thirdPartyNotices")');
    expect(source).toContain("title={APP_INFO_EXTERNAL_LINKS.repository}");
    expect(source).toContain("onClick={onOpenRepository}");
    expect(source).not.toContain("href=");
    expect(source).not.toContain("openExternal");
    expect(source).not.toContain("openPath");
    expect(source).not.toContain("onOpenThirdPartyNotices");
    // Historical typewriter-sounds identifiers / acknowledgement text are gone.
    expect(source).not.toContain("TypewriterSoundsCredit");
    expect(source).not.toContain("typewriterCredit");
    expect(source).not.toContain("creditsLabel");
    expect(source).not.toContain("thirdPartyGuidance");

    expect(APP_INFO_EXTERNAL_LINKS).toEqual({
      repository: "https://github.com/Pergamum-IDE/Pergamum-IDE"
    });
    const apiSource = readFileSync("src/shared/api.ts", "utf8");
    expect(apiSource).toContain('openLegalDocument: "appInfo:openLegalDocument"');
    expect(apiSource).not.toContain("blob/main/THIRD_PARTY");
    expect(apiSource).not.toContain("opengameart.org");
    expect(apiSource).not.toContain("TypewriterSoundsCredit");
  });

  it("restores copy state and shows failed feedback even if clipboard copy throws unexpectedly", () => {
    const source = readFileSync(
      "src/renderer/dialog/AboutDialog.tsx",
      "utf8"
    );
    const start = source.indexOf(
      "async function handleCopyTechnicalInformation"
    );
    const end = source.indexOf("return (", start);
    const handlerSource = source.slice(start, end);

    expect(handlerSource).toContain("try {");
    expect(handlerSource).toContain("catch {");
    expect(handlerSource).toContain("finally {");
    expect(handlerSource).toContain("copySucceeded = false");
    expect(handlerSource).toContain(
      "isCopyingTechnicalInfoRef.current = false"
    );
    expect(handlerSource).toContain("setIsCopyingTechnicalInfo(false)");
    expect(handlerSource).toContain(
      'showCopyFeedback(copySucceeded ? "copied" : "failed")'
    );
  });

  it("formats technical information for the explicit copy action", () => {
    expect(formatAboutTechnicalInformation(testAppInfo)).toBe(
      [
        "Pergamum: 9.8.7-test",
        "Electron: 43.4.0-test",
        "Chromium: 140.0.0-test",
        "Node.js: 24.0.0-test",
        "V8: 14.0-test",
        "OS: Windows_NT 10.0.26100-test",
        "Platform: win32 x64"
      ].join("\n")
    );
  });

  it("keeps the About branding layout centered and adds forced-colors affordance CSS", () => {
    const styles = readFileSync("src/renderer/styles.css", "utf8");
    const brandingCss = cssRuleBlock(styles, ".aboutDialogBranding");
    const appIconButtonCss = cssRuleBlock(styles, ".aboutDialogAppIconButton");
    const taglineCss = cssRuleBlock(styles, ".aboutDialogTagline");
    const externalLinkIconCss = cssRuleBlock(
      styles,
      ".aboutDialogExternalLinkIcon"
    );
    const linkButtonCss = cssRuleBlock(styles, ".aboutDialogLinkButton");
    const toastCss = cssRuleBlock(styles, ".aboutDialogCopyToast");
    const forcedColorsCss = styles.slice(
      styles.indexOf("@media (forced-colors: active)")
    );

    expect(brandingCss).toContain("align-items: center");
    expect(brandingCss).toContain("justify-content: center");
    expect(brandingCss).toContain("padding-inline");
    expect(appIconButtonCss).toContain("inline-size: 54px");
    expect(appIconButtonCss).toContain("background: transparent");
    expect(taglineCss).toContain("color: var(--pg-color-text-neutral-dark)");
    expect(linkButtonCss).toContain("display: inline-block");
    expect(linkButtonCss).toContain("max-width: 100%");
    expect(linkButtonCss).toContain("min-width: 0");
    expect(linkButtonCss).toContain("overflow-wrap: anywhere");
    expect(linkButtonCss).not.toContain("flex-wrap");
    expect(externalLinkIconCss).toContain("display: inline-block");
    expect(externalLinkIconCss).toContain("width: 14px");
    expect(externalLinkIconCss).toContain("vertical-align");
    expect(toastCss).toContain("position: absolute");
    expect(toastCss).toContain("inset-block-end");
    expect(toastCss).toContain("aboutDialogCopyToastOpacity");
    expect(toastCss).toContain(
      "--about-dialog-copy-feedback-animation-ms"
    );
    expect(styles).toContain("@keyframes aboutDialogCopyToastOpacity");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(forcedColorsCss).toContain("forced-color-adjust: none");
    expect(forcedColorsCss).toContain("LinkText");
    expect(forcedColorsCss).toContain("CanvasText");
  });

  it("uses one horizontal padding variable for dialog header, body, and footer alignment", () => {
    const styles = readFileSync("src/renderer/styles.css", "utf8");
    const appDialogCss = cssRuleBlock(styles, ".appDialog");
    const appInfoDialogCss = cssRuleBlock(styles, ".appInfoDialog");
    const headerCss = cssRuleBlock(styles, ".appDialogHeader");
    const bodyCss = cssRuleBlock(styles, ".appDialogBody");
    const infoBodyCss = cssRuleBlock(styles, ".appInfoDialogBody");
    const footerCss = cssRuleBlock(styles, ".appDialogFooter");

    expect(appDialogCss).toContain("--app-dialog-horizontal-padding: 16px");
    expect(appInfoDialogCss).toContain("--app-dialog-horizontal-padding: 20px");
    expect(styles).not.toContain("--app-info-dialog-horizontal-padding");
    expectDialogHorizontalPaddingVariable(headerCss);
    expectDialogHorizontalPaddingVariable(bodyCss);
    expectDialogHorizontalPaddingVariable(infoBodyCss);
    expect(infoBodyCss).toContain("min-height: 0");
    expectDialogHorizontalPaddingVariable(footerCss);
    expect(footerCss).toContain("border-top: 1px solid var(--app-dialog-border)");
  });

  it("keeps About footer button border boxes aligned to the content padding boundary", () => {
    const styles = readFileSync("src/renderer/styles.css", "utf8");
    const universalCss = cssRuleBlock(styles, "*");
    const footerContentCss = cssRuleBlock(styles, ".aboutDialogFooterContent");
    const copyButtonCss = cssRuleBlock(
      styles,
      ".aboutDialogCopyTechnicalButton"
    );
    const confirmButtonCss = cssRuleBlock(styles, ".appDialogButton-confirm");

    expect(universalCss).toContain("box-sizing: border-box");
    expect(footerContentCss).toContain("width: 100%");
    expect(copyButtonCss).not.toMatch(/\bmargin(?:-[a-z-]+)?\s*:/);
    expect(copyButtonCss).not.toContain("transform:");
    expect(confirmButtonCss).not.toMatch(/\bmargin(?:-[a-z-]+)?\s*:/);
    expect(confirmButtonCss).not.toContain("transform:");
  });

  it("keeps logo README free of stale missing sample image references", () => {
    const logoReadme = readFileSync("assets/logo/README.md", "utf8");

    expect(logoReadme).not.toMatch(/\.\/doc\/sample.*\.webp/);
  });

  it("does not hardcode the package version in AboutDialog or i18n messages", () => {
    const aboutSource = readFileSync(
      "src/renderer/dialog/AboutDialog.tsx",
      "utf8"
    );
    const jaSource = readFileSync("src/shared/i18n/ja.ts", "utf8");
    const enSource = readFileSync("src/shared/i18n/en.ts", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      version?: unknown;
    };

    expect(typeof packageJson.version).toBe("string");
    const packageVersion = packageJson.version as string;

    expect(aboutSource).not.toContain(packageVersion);
    expect(jaSource).not.toContain(packageVersion);
    expect(enSource).not.toContain(packageVersion);
  });
});
