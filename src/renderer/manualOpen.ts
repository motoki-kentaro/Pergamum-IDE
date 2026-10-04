import type { Language, TranslationKey, TranslationValues } from "../shared/i18n";
import { manualUrlForLanguage } from "../shared/manualUrl";
import type {
  AppConfirmDialogOptions,
  AppConfirmDialogResult
} from "./dialog/appDialogTypes";

export interface OpenManualDeps {
  readonly language: Language;
  readonly translate: (key: TranslationKey, values?: TranslationValues) => string;
  readonly confirmDialog: (
    options: AppConfirmDialogOptions
  ) => Promise<AppConfirmDialogResult>;
  /** The one sanctioned external-navigation path (`appInfo.openExternalUrl`,
   *  re-validated as http/https in the main process). */
  readonly openExternalUrl: (url: string) => Promise<void>;
}

/**
 * #737: Help > Manual. Resolves the manual URL of the CURRENT UI language,
 * asks first (the URL is shown, display-only, inside the dialog), and only on
 * an explicit "Yes" hands the URL to the sanctioned external-navigation path.
 * Cancel / Escape do nothing.
 */
export async function openManualWithConfirmation(
  deps: OpenManualDeps
): Promise<void> {
  const url = manualUrlForLanguage(deps.language);
  const result = await deps.confirmDialog({
    title: deps.translate("dialog.manualOpen.title"),
    message: {
      kind: "plainTextWithUrlRow",
      beforeText: deps.translate("dialog.manualOpen.message"),
      url
    },
    icon: {
      kind: "externalLink",
      tooltip: deps.translate("dialog.icon.externalLink")
    },
    clipboardText: null,
    confirmLabel: deps.translate("common.yes"),
    cancelLabel: deps.translate("common.cancel")
  });

  if (result === "confirm") {
    await deps.openExternalUrl(url);
  }
}
