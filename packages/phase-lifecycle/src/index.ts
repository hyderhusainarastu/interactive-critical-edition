/**
 * Governed project-phase lifecycle.
 *
 * This package deliberately contains no process-spawning fallback. A shell
 * command cannot prove that an agent's active context was destroyed, so the
 * closeout path only accepts a host-provided session adapter which can replace
 * the active context atomically. Hosts without that capability fail closed.
 */

export const DEFAULT_PHASE_RECORDS = {
  claude: "CLAUDE.md",
  canonicalProjectRecord: "docs/PROJECT-LOG.md",
  tracker: "docs/project-status.json",
} as const;

export interface PhaseRecordPaths {
  claude: string;
  canonicalProjectRecord: string;
  tracker: string;
}

export interface PhaseRecordReader {
  read(path: string): Promise<string>;
}

export interface PhaseTaskStart {
  task: string;
  records: Readonly<{
    claude: string;
    canonicalProjectRecord: string;
    tracker: string;
  }>;
}

export interface PhaseVerificationResult {
  passed: boolean;
  commands: readonly string[];
  summary: string;
}

export interface CompactPhaseHandoff {
  phase: number;
  decisions: readonly string[];
  changedFiles: readonly string[];
  testResults: readonly string[];
  remainingRisks: readonly string[];
  nextPhasePrompt: string;
}

export interface PhaseCloseoutInput {
  handoff: CompactPhaseHandoff;
  nextPhase: number;
}

export interface PhaseHandoffStore {
  write(handoff: CompactPhaseHandoff): Promise<void>;
}

export interface PhaseTrackerStore {
  updateForCloseout(input: { phase: number; nextPhase: number; verification: PhaseVerificationResult }): Promise<void>;
}

/**
 * The host owns model-context lifecycle. `replaceActiveContext` must first
 * terminate the active model context and then dispatch a new one using only
 * the supplied compact handoff/prompt. It is intentionally a single host
 * operation: once an active context is terminated, an in-process controller
 * cannot safely perform a second dispatch itself.
 */
export interface HostSessionAdapter {
  readonly name: string;
  canReplaceActiveContext(): Promise<boolean>;
  replaceActiveContext(input: {
    compactHandoff: CompactPhaseHandoff;
    nextPhase: number;
    prompt: string;
  }): Promise<{ newContextId: string }>;
}

export class ContextLifecycleUnavailableError extends Error {
  constructor(message = "The configured host cannot create a fresh model context; phase closeout stopped before context compaction was claimed.") {
    super(message);
    this.name = "ContextLifecycleUnavailableError";
  }
}

/** Default for local/CI use. It fails rather than simulating compaction. */
export class UnavailableHostSessionAdapter implements HostSessionAdapter {
  readonly name = "unavailable-host-session-adapter";

  async canReplaceActiveContext(): Promise<boolean> {
    return false;
  }

  async replaceActiveContext(): Promise<{ newContextId: string }> {
    throw new ContextLifecycleUnavailableError();
  }
}

export interface PhaseLifecycleDependencies {
  records: PhaseRecordReader;
  verify: (phase: number) => Promise<PhaseVerificationResult>;
  handoffs: PhaseHandoffStore;
  tracker: PhaseTrackerStore;
  hostSession: HostSessionAdapter;
  paths?: PhaseRecordPaths;
}

/**
 * A phase runner with deliberately narrow responsibilities. It has no path
 * exclusions: research material and rollout artifacts are read like any other
 * project material whenever the task calls for them.
 */
export class PhaseLifecycleController {
  private readonly paths: PhaseRecordPaths;

  constructor(private readonly dependencies: PhaseLifecycleDependencies) {
    this.paths = dependencies.paths ?? DEFAULT_PHASE_RECORDS;
  }

  /** Reads in the required order; callers receive immutable record content. */
  async startTask(task: string): Promise<PhaseTaskStart> {
    const claude = await this.dependencies.records.read(this.paths.claude);
    const canonicalProjectRecord = await this.dependencies.records.read(this.paths.canonicalProjectRecord);
    const tracker = await this.dependencies.records.read(this.paths.tracker);
    return {
      task,
      records: Object.freeze({ claude, canonicalProjectRecord, tracker }),
    };
  }

  /**
 * Preflights the host, then completes durable closeout work before asking it
 * to replace the context. A failed test or unavailable host never advances
 * the phase tracker.
   */
  async closePhase(input: PhaseCloseoutInput): Promise<{ newContextId: string; verification: PhaseVerificationResult }> {
    if (input.nextPhase !== input.handoff.phase + 1) {
      throw new Error(`Phase ${input.handoff.phase} can only dispatch its immediate successor; received Phase ${input.nextPhase}.`);
    }
    if (!input.handoff.nextPhasePrompt.trim()) throw new Error("A compact next-phase prompt is required for context replacement.");

    const verification = await this.dependencies.verify(input.handoff.phase);
    if (!verification.passed) {
      throw new Error(`Phase ${input.handoff.phase} verification failed: ${verification.summary}`);
    }

    if (!(await this.dependencies.hostSession.canReplaceActiveContext())) {
      throw new ContextLifecycleUnavailableError(
        `Host session adapter ${this.dependencies.hostSession.name} cannot replace the active context. Phase closeout stopped before tracker advancement, compaction, or Phase ${input.nextPhase} dispatch was claimed.`,
      );
    }

    await this.dependencies.handoffs.write(input.handoff);
    await this.dependencies.tracker.updateForCloseout({
      phase: input.handoff.phase,
      nextPhase: input.nextPhase,
      verification,
    });

    const replacement = await this.dependencies.hostSession.replaceActiveContext({
      compactHandoff: input.handoff,
      nextPhase: input.nextPhase,
      prompt: input.handoff.nextPhasePrompt,
    });
    if (!replacement.newContextId.trim()) throw new ContextLifecycleUnavailableError("Host session replacement returned no fresh context identifier.");
    return { newContextId: replacement.newContextId, verification };
  }
}
