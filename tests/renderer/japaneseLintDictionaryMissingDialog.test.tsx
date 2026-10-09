// @vitest-environment happy-dom
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t, type Translate } from "../../src/shared/i18n";
import { useJapaneseLintDictionaryMissingDialog } from "../../src/renderer/japaneseLint/useJapaneseLintDictionaryMissingDialog";
import { DialogController } from "../../src/renderer/dialog/dialogController";
import { ConfirmDialog } from "../../src/renderer/dialog/ConfirmDialog";
import { JapaneseMachineCheckDialog, type JapaneseMachineCheckBridge } from "../../src/renderer/dialog/JapaneseMachineCheckDialog";

const translate: Translate = (key, values) => t("ja", key, values);
let root: Root;
let container: HTMLDivElement;
let controller: DialogController;
let notice: ReturnType<typeof useJapaneseLintDictionaryMissingDialog>;
let manualBridge: JapaneseMachineCheckBridge;
let setManual: (open: boolean) => void;
const confirm = vi.fn((options: Parameters<DialogController["confirm"]>[0]) => controller.confirm(options));

function Harness({ blocked = false, ready = true, documentKey = "project-a/tab-a" }) {
  const [pending, setPending] = useState(controller.getPendingRequest());
  const [manual, changeManual] = useState(false);
  setManual = changeManual;
  useEffect(() => controller.subscribe(() => setPending(controller.getPendingRequest())), []);
  notice = useJapaneseLintDictionaryMissingDialog({
    ready, blocked: blocked || manual || pending !== null,
    isDialogPending: () => controller.getPendingRequest() !== null,
    confirm, translate
  });
  return <>
    <span>{documentKey}</span>
    {blocked ? <div role="dialog">Other modal</div> : null}
    {manual ? <JapaneseMachineCheckDialog
      target={{ kind: "projectFile", relativePath: "a.md", isDirty: false }}
      translate={translate} bridge={manualBridge}
      onClose={() => changeManual(false)}
      onDictionaryMissing={() => { notice.beginAttempt(); notice.notify(); }}
    /> : null}
    {pending?.kind === "confirm" ? <ConfirmDialog
      options={pending.options} actionOrder="confirmCancel" translate={translate}
      clipboardAdapter={{ writeText: async () => undefined }} opener={null}
      onResult={(result) => controller.resolve(result)}
    /> : null}
  </>;
}

async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(<Harness {...props} />));
}
async function dismiss() {
  const ok = [...container.querySelectorAll("button")].find((button) => button.textContent === "OK");
  expect(ok).toBeDefined();
  await act(async () => ok!.click());
}

beforeEach(() => {
  controller = new DialogController();
  confirm.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  manualBridge = {
    prepare: async () => ({ ok: true, targetKind: "projectFile", displayName: "a.md",
      ext: ".md", format: "markdown", sourceChars: 8, sourceLines: 1,
      isDirty: false, enabledRuleIds: ["no-doubled-joshi"], estimate: "short" }),
    run: vi.fn(async () => ({ ok: false, reason: "dictionary-missing" } as const)),
    cancel: vi.fn(async () => undefined), discardResult: vi.fn(async () => undefined),
    saveReport: vi.fn(async () => ({ ok: false, reason: "not-ready" } as const)),
    onProgress: () => () => undefined
  };
});
afterEach(async () => {
  await act(async () => { controller.dispose(); root.unmount(); });
  container.remove();
});

describe("shared dictionary-missing dialog (#775)", () => {
  it("shows the exact recovery guidance once, survives document switches, and permits an explicit retry", async () => {
    await render();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { notice.notify(); notice.notify(); });
    expect(container.textContent).toContain(t("ja", "japaneseLint.dictionaryMissing.title"));
    expect(container.textContent).toContain(t("ja", "japaneseLint.dictionaryMissing.message"));
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    await dismiss();
    for (const documentKey of ["project-a/tab-b", "project-b/tab-a"]) {
      await render({ documentKey });
      await act(async () => notice.notify());
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    }
    expect(confirm).toHaveBeenCalledTimes(1);
    await act(async () => { notice.beginAttempt(); notice.notify(); });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("waits for startup and other modals without losing or duplicating the notice", async () => {
    await render({ ready: false, blocked: true });
    await act(async () => { notice.notify(); notice.notify(); });
    expect(confirm).not.toHaveBeenCalled();
    await render({ ready: true, blocked: true });
    expect(confirm).not.toHaveBeenCalled();
    await render();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it("replaces the manual wizard with the same dialog, stops results, and coalesces an instant failure", async () => {
    await render();
    await act(async () => setManual(true));
    await act(async () => notice.notify());
    expect(confirm).not.toHaveBeenCalled();
    const run = [...container.querySelectorAll("button")].find((button) => button.textContent === t("ja", "japaneseMachineCheck.button.run"));
    expect(run).toBeDefined();
    await act(async () => run!.click());
    expect(manualBridge.run).toHaveBeenCalledTimes(1);
    expect(manualBridge.saveReport).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.textContent).toContain(t("ja", "japaneseLint.dictionaryMissing.title"));
    expect(container.textContent).not.toContain(t("ja", "japaneseMachineCheck.error.generic"));
    expect(confirm).toHaveBeenCalledTimes(1);
    await dismiss();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("engine-unavailable (#778) shows its own dialog with a copyable, unchanged technical info, once", async () => {
    await render();
    await act(async () => {
      notice.notifyEngineUnavailable("TECH INFO");
      notice.notifyEngineUnavailable("TECH INFO");
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({
      clipboardText: "TECH INFO",
      clipboardTextTitle: t("ja", "dialog.copyTechnicalInfo"),
      cancelLabel: null
    });
    expect(container.textContent).toContain(t("ja", "japaneseLint.engineUnavailable.title"));
    expect(container.textContent).toContain("日本語校正を停止します。文書の編集と保存は引き続き利用できます。");
    expect(container.textContent).not.toContain(t("ja", "japaneseLint.dictionaryMissing.title"));
    await dismiss();
  });

  it("dictionary-missing is not turned into the engine dialog and goes first when both are due (#778 / #775)", async () => {
    await render({ ready: false });
    await act(async () => {
      notice.notifyEngineUnavailable("TECH INFO");
      notice.notify();
    });
    await render({ ready: true });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(t("ja", "japaneseLint.dictionaryMissing.title"));
    expect(container.textContent).not.toContain(t("ja", "japaneseLint.engineUnavailable.title"));
    await dismiss();
  });

  it.each(["lint-failed", "worker-failed"] as const)("keeps %s in the existing manual error screen", async (reason) => {
    manualBridge.run = vi.fn(async () => ({ ok: false, reason } as const));
    await render();
    await act(async () => setManual(true));
    const run = [...container.querySelectorAll("button")].find((button) => button.textContent === t("ja", "japaneseMachineCheck.button.run"));
    await act(async () => run!.click());
    expect(container.textContent).toContain(t("ja", "japaneseMachineCheck.error.generic"));
    expect(confirm).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
