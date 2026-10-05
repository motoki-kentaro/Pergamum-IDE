import path from "node:path";
import type { MessageBoxOptions } from "electron";
import { t, type Language } from "../shared/i18n";
import { createUuidv7 } from "../shared/uuidv7";
import {
  DEFAULT_PRIMARY_ROUTER_POLICY,
  type PrimaryRouterStatus,
} from "./primaryRouterCoordination";
import type { LaunchHandoffResult } from "./launchHandoff";
import type { RuntimeLaunchParseResult, RuntimeLaunchParseRejection } from "./runtimeLaunchRouting";
import type {
  RuntimeLaunchQueue,
  RuntimeLaunchDispatchSink,
} from "./runtimeLaunchQueue";

export const DEFAULT_EXTERNAL_STARTUP_POLICY = {
  maxObservations: 10,
  observationIntervalMs: DEFAULT_PRIMARY_ROUTER_POLICY.scanIntervalMs,
  operationTimeoutMs: 5000,
};
interface StartupRouter {
  current(): PrimaryRouterStatus;
  refresh(): Promise<PrimaryRouterStatus>;
  handoff(launch: RuntimeLaunchParseResult): Promise<LaunchHandoffResult>;
}
export type ExternalLaunchStartupResult =
  | { kind: "coldStart" }
  | { kind: "queuedColdStart"; requestId: string; target: string }
  | { kind: "handedOff" }
  | { kind: "rejected"; reason: Exclude<RuntimeLaunchParseRejection, "noTarget"> | "invalidTarget" }
  | {
      kind: "routingUnconfirmed";
      reason:
        | "coordinationUnavailable"
        | "discoveryTimeout"
        | "stopping"
        | "queueRejected"
        | "handoffUnconfirmed";
    };

/** Startup rejection precedes Renderer/AppDialogController initialization. */
export function externalLaunchRejectionDialog(
  result: Extract<ExternalLaunchStartupResult, { kind: "rejected" }>,
  language: Language,
): MessageBoxOptions {
  return {
    type: "info",
    title: "Pergamum",
    message: t(language, "dialog.startupMarkdownRejected.title"),
    ...(result.reason === "urlLikeInput" ? {
      detail: t(language, "dialog.startupMarkdownRejected.reason.urlLikeInput"),
    } : {}),
    buttons: [t(language, "common.ok")],
    defaultId: 0,
    cancelId: 0,
  };
}
function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Startup routing deadline exceeded.")),
      timeoutMs,
    );
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
/** No filesystem classification, Project open, Recovery or window creation may
 * precede this decision. Unconfirmed delivery never permits local fallback.
 */
export async function routeExternalLaunchStartup(options: {
  launch: RuntimeLaunchParseResult;
  router: () => Promise<StartupRouter | null>;
  enqueue: RuntimeLaunchQueue["enqueue"];
  wait?: (ms: number) => Promise<void>;
  policy?: typeof DEFAULT_EXTERNAL_STARTUP_POLICY;
}): Promise<ExternalLaunchStartupResult> {
  const policy = options.policy ?? DEFAULT_EXTERNAL_STARTUP_POLICY;
  if (Object.values(policy).some((v) => !Number.isSafeInteger(v) || v <= 0))
    throw new Error("Invalid external startup policy.");
  const launch = options.launch;
  // An ordinary no-target startup still restores its Session. Malformed input
  // never becomes an implicit local-open fallback.
  if (launch.kind === "rejected")
    return launch.reason === "noTarget"
      ? { kind: "coldStart" }
      : { kind: "rejected", reason: launch.reason };
  if (launch.origin === "routedChild") return { kind: "coldStart" };
  try {
    const router = await bounded(options.router(), policy.operationTimeoutMs);
    if (!router) return { kind: "routingUnconfirmed", reason: "coordinationUnavailable" };
    for (
      let observation = 0;
      observation < policy.maxObservations;
      observation++
    ) {
      const status = router.current();
      if (status.kind === "primary") {
        const target = path.resolve(
          launch.target.kind === "pergamum"
            ? launch.target.filePath
            : launch.target.rawInput,
        );
        const requestId = createUuidv7();
        // No await between authority observation and ownership acquisition.
        const accepted = options.enqueue({ requestId, target, launch });
        return accepted.kind === "accepted"
          ? { kind: "queuedColdStart", requestId, target }
          : { kind: "routingUnconfirmed", reason: "queueRejected" };
      }
      if (status.kind === "secondary") {
        // The existing sender already bounds retries/refresh and preserves one
        // requestId. Its own timeout covers transport uncertainty; do not resend
        // from this outer startup gate under a new identity.
        const result = await router.handoff(launch);
        if (result.kind === "delivered") return { kind: "handedOff" };
        if (result.kind === "notSent" && result.reason === "invalidTarget")
          return { kind: "rejected", reason: "invalidTarget" };
        if (result.kind !== "notSent" || result.reason !== "alreadyPrimary")
          return { kind: "routingUnconfirmed", reason: "handoffUnconfirmed" };
      }
      if (status.kind === "stopping")
        return { kind: "routingUnconfirmed", reason: "stopping" };
      if (observation + 1 < policy.maxObservations) {
        await bounded(
          (
            options.wait ??
            ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
          )(policy.observationIntervalMs),
          policy.observationIntervalMs + policy.operationTimeoutMs,
        );
        await bounded(router.refresh(), policy.operationTimeoutMs);
      }
    }
    return { kind: "routingUnconfirmed", reason: "discoveryTimeout" };
  } catch {
    return { kind: "routingUnconfirmed", reason: "coordinationUnavailable" };
  }
}

/** The first target of a newly elected Primary bootstraps its window through
 * the ordinary cold-start lifecycle, not runtime .pergamum spawning. Queue
 * ownership is released only after Main's delivery path and startup settle.
 */
export function withColdStartOwnership(options: {
  initial: Extract<
    ExternalLaunchStartupResult,
    { kind: "queuedColdStart" }
  > | null;
  coldStartOwned: () => boolean;
  downstream: RuntimeLaunchDispatchSink;
}): RuntimeLaunchDispatchSink {
  return async (entry) => {
    if (entry.requestId === options.initial?.requestId) {
      return entry.target === options.initial.target && options.coldStartOwned()
        ? { kind: "accepted" }
        : { kind: "temporaryFailure" };
    }
    return options.downstream(entry);
  };
}
