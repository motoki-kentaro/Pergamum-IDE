# Dialog guidelines

Rules for dialogs that Pergamum renders itself (Renderer side). They were fixed in
#802 after the cross-dialog audit and build on #801 (external URL confirmation).
Electron / OS native dialogs (file pickers, `showMessageBox`) are out of scope: the
OS decides their look and button order.

## Button order and emphasis

- Non-executing actions (Cancel, Back) are on the left; the executing action
  (Open, Save, Overwrite, Delete, Next, Export) is on the right. This applies on
  every platform. There is no per-platform action order.
- `ConfirmDialog` always renders `[Cancel][Confirm]`. Input dialogs and wizards
  built on `InfoDialog` follow the same order.
- Stacked `ChoiceDialog` buttons run top to bottom: primary, other choices, Cancel.
  Keep the data-loss choice visually distinct (destructive role) and never focused
  initially.
- The executing button uses `appDialogButton-confirm`; irreversible actions use
  `appDialogButton-choice-destructive` (or `tone: "destructive"` on
  `ConfirmDialog`). Do not invent other primary classes.

## Initial focus, Enter, Escape

- Destructive or irreversible actions (delete, overwrite, discard, loss of unsaved
  changes): initial focus is Cancel, so an initial Enter never executes them.
  `ConfirmDialog` does this for `tone: "destructive"`; `ChoiceDialog` falls back
  to Cancel unless `initialFocusChoiceId` is set.
- Non-destructive confirmations focus the executing button; input dialogs focus
  the input field.
- Escape cancels. A backdrop click cancels only for non-destructive
  `ConfirmDialog`s; destructive ones ignore it unless a caller opts in.

## Labels and copy

- Button labels say what happens: Open, Save, Overwrite, Delete, Discard changes
  and continue. Do not use Yes/No.
- A single notification or result uses "OK". A screen whose purpose is to be
  dismissed (About, read-only reports) uses "Close".
- While a wizard or operation is still pending, leaving is "Cancel"; after it is
  complete it is "Close". Aborting a half-done batch may use a distinct verb
  (for example "Abort" for deletion) because earlier steps are not undone.
- Title is a noun phrase or a question; the message does not repeat the same
  question. Messages are declarative and state consequences (including
  "cannot be undone"). Ask a question in the body only when the title is not one.
- Warning icons use the shared warning tooltip (`dialog.icon.warning`), not the
  dialog title.
- English button labels use sentence case ("Discard changes and close").
- User-facing text goes through `src/shared/i18n/ja.ts` / `en.ts`; keep ja and en
  in the same meaning.

## Intentional differences

- External URL confirmation: declarative message, "Open" primary (#801).
- Multi-choice dialogs (move/copy, update links/keep links/cancel) keep their
  three-way structure and focus the safest choice.
