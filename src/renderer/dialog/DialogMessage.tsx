import type { JSX } from "react";
import type { AppDialogMessage } from "./appDialogTypes";
import { MaskedIcon } from "../MaskedIcon";
import linkExternalIconUrl from "../../../assets/icons/codicons/dialog/link-external.svg?url";

export interface DialogMessageProps {
  readonly id: string;
  readonly message: AppDialogMessage;
}

export function DialogMessage({
  id,
  message
}: DialogMessageProps): JSX.Element {
  if (message.kind === "plainText") {
    return (
      <p id={id} className="appDialogMessage">
        {message.text}
      </p>
    );
  }

  if (message.kind === "plainTextWithUrlRow") {
    // #737: the URL and its icon are DISPLAY ONLY — no anchor, no button, no
    // handler — so the only way to open the browser is the dialog's confirm
    // button. The icon is decorative (MaskedIcon hides it from assistive tech).
    return (
      <div id={id} className="appDialogMessage appDialogMessage-blocks">
        <p className="appDialogMessageText">{message.beforeText}</p>
        <div className="appDialogUrlRow" data-testid="appDialogUrlRow">
          <span className="appDialogUrlText">{message.url}</span>
          <MaskedIcon url={linkExternalIconUrl} className="appDialogUrlIcon" />
        </div>
      </div>
    );
  }

  return (
    <div id={id} className="appDialogMessage appDialogMessage-blocks">
      {message.beforeText ? (
        <p className="appDialogMessageText">{message.beforeText}</p>
      ) : null}
      <div className="appDialogPathBlock">
        <div className="appDialogPathBlockLabel">{message.pathBlock.label}</div>
        <div className="appDialogPathBlockValue">
          {message.pathBlock.value}
        </div>
      </div>
      {message.afterText ? (
        <p className="appDialogMessageText">{message.afterText}</p>
      ) : null}
    </div>
  );
}
