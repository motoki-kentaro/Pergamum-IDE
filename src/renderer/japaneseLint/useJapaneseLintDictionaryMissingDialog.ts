import { useCallback, useEffect, useRef, useState } from "react";
import type { Translate } from "../../shared/i18n";
import type { AppConfirmDialogOptions, AppConfirmDialogResult } from "../dialog/appDialogTypes";
import { DeferredErrorDialogQueue } from "../dialog/deferredErrorDialogQueue";

const cause = "japaneseLintDictionaryMissing";
// #778: the engine could not start within the configured attempts.
const engineCause = "japaneseLintEngineUnavailable";
// A missing dictionary is the more specific diagnosis: it goes first.
const createQueue = () => new DeferredErrorDialogQueue([cause, engineCause]);

/** App-owned: automatic reruns and document/project switches never re-arm it. */
export function useJapaneseLintDictionaryMissingDialog(options: {
  ready: boolean;
  blocked: boolean;
  isDialogPending: () => boolean;
  confirm: (options: AppConfirmDialogOptions) => Promise<AppConfirmDialogResult>;
  translate: Translate;
}) {
  const queue = useRef(createQueue());
  const [revision, setRevision] = useState(0);
  const technicalInfo = useRef<string | null>(null);
  const latest = useRef(options);
  latest.current = options;

  // Only an explicit user retry can re-arm an already acknowledged failure.
  // An outstanding notification is shared by simultaneous manual/instant runs.
  const beginAttempt = useCallback(() => {
    if (!queue.current.hasOutstanding()) {
      queue.current = createQueue();
    }
  }, []);
  const notify = useCallback(() => {
    if (queue.current.arm(cause)) {
      setRevision((value) => value + 1);
    }
  }, []);

  const notifyEngineUnavailable = useCallback((info: string) => {
    technicalInfo.current = info;
    if (queue.current.arm(engineCause)) {
      setRevision((value) => value + 1);
    }
  }, []);

  useEffect(() => {
    if (!options.ready || options.blocked) {
      return;
    }
    queue.current.markReady();
    const presentation = queue.current.pump({
      isDialogPending: () => latest.current.blocked || latest.current.isDialogPending(),
      present: (id) => {
        // Another modal may have opened between pump and this microtask.
        if (latest.current.blocked || latest.current.isDialogPending()) {
          return Promise.reject(new Error("dialogAlreadyOpen"));
        }
        const { translate, confirm } = latest.current;
        if (id === engineCause) {
          return confirm({
            title: translate("japaneseLint.engineUnavailable.title"),
            message: {
              kind: "plainText",
              text: translate("japaneseLint.engineUnavailable.message")
            },
            icon: { kind: "error", tooltip: translate("dialog.icon.error") },
            confirmLabel: translate("common.ok"),
            cancelLabel: null,
            clipboardText: technicalInfo.current,
            clipboardTextTitle: translate("dialog.copyTechnicalInfo"),
            dismissOnBackdropClick: false
          });
        }
        return confirm({
          title: translate("japaneseLint.dictionaryMissing.title"),
          message: { kind: "plainText", text: translate("japaneseLint.dictionaryMissing.message") },
          icon: { kind: "error", tooltip: translate("dialog.icon.error") },
          confirmLabel: translate("common.ok"),
          cancelLabel: null,
          clipboardText: null,
          dismissOnBackdropClick: false
        });
      }
    });
    if (presentation) {
      void presentation.then(() => setRevision((value) => value + 1));
    }
  }, [options.ready, options.blocked, revision]);

  return { notify, notifyEngineUnavailable, beginAttempt };
}
