/**
 * #778: the copyable technical information of "the Japanese proofreading
 * engine could not be started". Built in the Main Process from enumerated
 * values and numbers only - never from manuscript text, project or document
 * names, paths, environment variables or Worker message text - so it is
 * safe to put on the clipboard and paste into a bug report.
 */

export interface JapaneseLintEngineTechnicalInfoInput {
  readonly appVersion: string;
  readonly platform: string;
  /** Where the engine ended up (a Host state such as "failed"). */
  readonly engineState: string;
  /** Start attempts actually made (1 + restarts used). */
  readonly attempts: number;
  /** The `JapaneseLinter.workerRestartAttempts` value in effect. */
  readonly workerRestartAttempts: number;
  /** An enumerated failure kind of the last attempt. */
  readonly lastFailureKind: string;
  readonly exitCode?: number | null;
  readonly exitSignal?: string | null;
}

export function formatJapaneseLintEngineTechnicalInfo(
  input: JapaneseLintEngineTechnicalInfoInput
): string {
  const lines = [
    "Pergamum Japanese Lint Engine Startup Failure",
    `App Version: ${input.appVersion}`,
    `Platform: ${input.platform}`,
    `Engine State: ${input.engineState}`,
    `Start Attempts: ${input.attempts}`,
    `JapaneseLinter.workerRestartAttempts: ${input.workerRestartAttempts}`,
    `Last Failure: ${input.lastFailureKind}`
  ];

  if (input.exitCode !== undefined && input.exitCode !== null) {
    lines.push(`Worker Exit Code: ${input.exitCode}`);
  }

  if (input.exitSignal) {
    lines.push(`Worker Exit Signal: ${input.exitSignal}`);
  }

  return lines.join("\n");
}
