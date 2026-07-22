import { describe, expect, it } from "vitest";
import {
  ContextLifecycleUnavailableError,
  PhaseLifecycleController,
  type CompactPhaseHandoff,
  type HostSessionAdapter,
} from "./index";

const handoff: CompactPhaseHandoff = {
  phase: 17,
  decisions: ["Keep cited works in the Library before asynchronous resolution."],
  changedFiles: ["packages/phase-lifecycle/src/index.ts"],
  testResults: ["unit tests passed"],
  remainingRisks: ["Host context handoff requires a configured host adapter."],
  nextPhasePrompt: "Begin Phase 18 from this compact handoff only.",
};

describe("PhaseLifecycleController", () => {
  it("reads CLAUDE, the canonical record, then the tracker for every task", async () => {
    const reads: string[] = [];
    const controller = new PhaseLifecycleController({
      records: { read: async (path) => { reads.push(path); return path; } },
      verify: async () => ({ passed: true, commands: [], summary: "ok" }),
      handoffs: { write: async () => undefined },
      tracker: { updateForCloseout: async () => undefined },
      hostSession: { name: "test", canReplaceActiveContext: async () => true, replaceActiveContext: async () => ({ newContextId: "new" }) },
    });

    const start = await controller.startTask("citation repair");
    expect(reads).toEqual(["CLAUDE.md", "docs/PROJECT-LOG.md", "docs/project-status.json"]);
    expect(start.records.tracker).toBe("docs/project-status.json");
  });

  it("writes verified closeout before atomically replacing the host context", async () => {
    const events: string[] = [];
    const adapter: HostSessionAdapter = {
      name: "host",
      canReplaceActiveContext: async () => { events.push("capability"); return true; },
      replaceActiveContext: async ({ compactHandoff, nextPhase }) => {
        events.push(`replace:${compactHandoff.phase}->${nextPhase}`);
        return { newContextId: "fresh-context" };
      },
    };
    const controller = new PhaseLifecycleController({
      records: { read: async () => "" },
      verify: async () => { events.push("verify"); return { passed: true, commands: ["pnpm test"], summary: "ok" }; },
      handoffs: { write: async () => { events.push("handoff"); } },
      tracker: { updateForCloseout: async () => { events.push("tracker"); } },
      hostSession: adapter,
    });

    await expect(controller.closePhase({ handoff, nextPhase: 18 })).resolves.toMatchObject({ newContextId: "fresh-context" });
    expect(events).toEqual(["verify", "capability", "handoff", "tracker", "replace:17->18"]);
  });

  it("fails clearly when the host cannot create a fresh context", async () => {
    const events: string[] = [];
    const controller = new PhaseLifecycleController({
      records: { read: async () => "" },
      verify: async () => { events.push("verify"); return { passed: true, commands: [], summary: "ok" }; },
      handoffs: { write: async () => { events.push("handoff"); } },
      tracker: { updateForCloseout: async () => { events.push("tracker"); } },
      hostSession: { name: "no-host", canReplaceActiveContext: async () => { events.push("capability"); return false; }, replaceActiveContext: async () => ({ newContextId: "never" }) },
    });

    await expect(controller.closePhase({ handoff, nextPhase: 18 })).rejects.toBeInstanceOf(ContextLifecycleUnavailableError);
    expect(events).toEqual(["verify", "capability"]);
  });
});
