export interface StartupRoutingSettlement {
  restoreSettled: boolean;
  markdownSettled: boolean;
  recoveryStatus: "unknown" | "owner" | "nonOwner" | "unavailable";
  recoveryEvaluationSettled: boolean;
  deferredErrorsOutstanding: boolean;
  modalOpen: boolean;
  lifecycleBarrier: boolean;
}
export function startupRoutingIsSettled(
  state: StartupRoutingSettlement,
): boolean {
  return (
    state.restoreSettled &&
    state.markdownSettled &&
    state.recoveryStatus !== "unknown" &&
    (state.recoveryStatus !== "owner" || state.recoveryEvaluationSettled) &&
    !state.deferredErrorsOutstanding &&
    !state.modalOpen &&
    !state.lifecycleBarrier
  );
}
