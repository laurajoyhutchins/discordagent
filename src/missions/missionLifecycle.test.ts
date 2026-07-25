import { describe, expect, it } from "vitest";

import {
  MissionConflictError,
  MissionRepository,
  MissionTransitionError,
  projectMission,
  type MissionBinding,
  type MissionEvidence,
} from "./missionLifecycle.js";

const binding: MissionBinding = {
  missionId: "mission-1",
  promotionIdempotencyKey: "interaction-1",
  discordSourceMessageId: "message-1",
  discordMissionThreadId: "thread-1",
  canonicalPacketId: "LJH-77",
};

const evidence = (
  kind: MissionEvidence["kind"],
  reference = `${kind}-receipt`,
): MissionEvidence => ({
  kind,
  reference,
  recordedAt: "2026-07-24T18:33:21-06:00",
});

const captured = (): MissionRepository => {
  const repository = new MissionRepository();
  repository.promote(binding, evidence("capture"));
  return repository;
};

const progressToInProgress = (repository: MissionRepository): void => {
  repository.transition(binding.missionId, {
    state: "ROUTED",
    owner: "Brigid",
    evidence: evidence("route"),
  });
  repository.transition(binding.missionId, {
    state: "AWAITING_CLAIM",
    evidence: evidence("wake"),
  });
  repository.transition(binding.missionId, {
    state: "CLAIMED",
    evidence: evidence("claim"),
  });
  repository.transition(binding.missionId, {
    state: "IN_PROGRESS",
    evidence: evidence("execution"),
  });
};

describe("MissionRepository", () => {
  it("replays the same promotion as the same mission binding", () => {
    const repository = captured();

    const replay = repository.promote(binding, evidence("capture", "duplicate"));

    expect(replay).toEqual(repository.get(binding.missionId));
    expect(replay.evidence).toHaveLength(1);
  });

  it.each([
    ["promotion interaction", { promotionIdempotencyKey: "interaction-1" }],
    ["source message", { discordSourceMessageId: "message-1" }],
    ["mission thread", { discordMissionThreadId: "thread-1" }],
  ])("fails closed when a %s is rebound", (_name, conflict) => {
    const repository = captured();

    expect(() =>
      repository.promote(
        {
          ...binding,
          ...conflict,
          missionId: "mission-2",
          canonicalPacketId: "LJH-999",
        },
        evidence("capture"),
      ),
    ).toThrow(MissionConflictError);
  });

  it("rejects an illegal jump from capture to claim", () => {
    const repository = captured();

    expect(() =>
      repository.transition(binding.missionId, {
        state: "CLAIMED",
        owner: "Brigid",
        evidence: evidence("claim"),
      }),
    ).toThrow(MissionTransitionError);
  });

  it("does not treat a wake receipt as a claim", () => {
    const repository = captured();
    repository.transition(binding.missionId, {
      state: "ROUTED",
      owner: "Brigid",
      evidence: evidence("route"),
    });
    const awaitingClaim = repository.transition(binding.missionId, {
      state: "AWAITING_CLAIM",
      evidence: evidence("wake"),
    });

    expect(awaitingClaim.state).toBe("AWAITING_CLAIM");
    expect(() =>
      repository.transition(binding.missionId, {
        state: "CLAIMED",
      }),
    ).toThrow(/fresh claim evidence/);
  });

  it("does not treat a claim receipt as material execution", () => {
    const repository = captured();
    repository.transition(binding.missionId, {
      state: "ROUTED",
      owner: "Brigid",
      evidence: evidence("route"),
    });
    repository.transition(binding.missionId, {
      state: "AWAITING_CLAIM",
      evidence: evidence("wake"),
    });
    const claimed = repository.transition(binding.missionId, {
      state: "CLAIMED",
      evidence: evidence("claim"),
    });

    expect(claimed.state).toBe("CLAIMED");
    expect(() =>
      repository.transition(binding.missionId, {
        state: "IN_PROGRESS",
      }),
    ).toThrow(/fresh execution evidence/);
  });

  it("requires fresh execution evidence after changes are requested", () => {
    const repository = captured();
    progressToInProgress(repository);
    repository.transition(binding.missionId, {
      state: "CHANGES_REQUESTED",
      evidence: evidence("verification", "first-verification"),
    });

    expect(() =>
      repository.transition(binding.missionId, {
        state: "IN_PROGRESS",
      }),
    ).toThrow(/fresh execution evidence/);
  });

  it.each(["VERIFIED", "CHANGES_REQUESTED"] as const)(
    "requires fresh verification evidence for IN_PROGRESS -> %s",
    (state) => {
      const repository = captured();
      progressToInProgress(repository);

      expect(() =>
        repository.transition(binding.missionId, {
          state,
        }),
      ).toThrow(/fresh verification evidence/);
    },
  );

  it("cannot reuse historical execution and verification receipts across a cycle", () => {
    const repository = captured();
    progressToInProgress(repository);
    repository.transition(binding.missionId, {
      state: "CHANGES_REQUESTED",
      evidence: evidence("verification", "first-verification"),
    });

    expect(() =>
      repository.transition(binding.missionId, {
        state: "IN_PROGRESS",
        evidence: evidence("verification", "stale-kind"),
      }),
    ).toThrow(/fresh execution evidence/);

    repository.transition(binding.missionId, {
      state: "IN_PROGRESS",
      evidence: evidence("execution", "fresh-correction"),
    });

    expect(() =>
      repository.transition(binding.missionId, {
        state: "VERIFIED",
        evidence: evidence("execution", "stale-kind-again"),
      }),
    ).toThrow(/fresh verification evidence/);
  });

  it("preserves evidence across verification return and completion", () => {
    const repository = captured();
    progressToInProgress(repository);
    repository.transition(binding.missionId, {
      state: "CHANGES_REQUESTED",
      evidence: evidence("verification", "verification-return"),
      nextAction: "Correct the projection",
    });
    repository.transition(binding.missionId, {
      state: "IN_PROGRESS",
      evidence: evidence("execution", "correction"),
    });
    repository.transition(binding.missionId, {
      state: "VERIFIED",
      evidence: evidence("verification", "verified-head"),
    });
    const done = repository.transition(binding.missionId, {
      state: "DONE",
      evidence: evidence("completion"),
    });

    expect(done.evidence.map((item) => item.reference)).toEqual([
      "capture-receipt",
      "route-receipt",
      "wake-receipt",
      "claim-receipt",
      "execution-receipt",
      "verification-return",
      "correction",
      "verified-head",
      "completion-receipt",
    ]);
  });

  it("requires evidence when ownership changes through re-routing", () => {
    const repository = captured();
    repository.transition(binding.missionId, {
      state: "ROUTED",
      owner: "Brigid",
      evidence: evidence("route"),
    });

    expect(() =>
      repository.transition(binding.missionId, {
        state: "ROUTED",
        owner: "Ariadne",
        evidence: evidence("route", "unsupported-owner-change"),
      }),
    ).toThrow(/fresh reroute evidence/);

    const rerouted = repository.transition(binding.missionId, {
      state: "ROUTED",
      owner: "Ariadne",
      evidence: evidence("reroute"),
    });
    expect(rerouted.currentOwner).toBe("Ariadne");
    expect(rerouted.evidence.at(-1)?.kind).toBe("reroute");
  });

  it("preserves prior evidence when cancelled", () => {
    const repository = captured();
    repository.transition(binding.missionId, {
      state: "ROUTED",
      owner: "Brigid",
      evidence: evidence("route"),
    });
    const cancelled = repository.transition(binding.missionId, {
      state: "CANCELLED",
      evidence: evidence("cancellation"),
      blocker: "Operator cancelled the mission",
    });

    expect(cancelled.evidence.map((item) => item.kind)).toEqual([
      "capture",
      "route",
      "cancellation",
    ]);
  });

  it("reconstructs deterministically after restart", () => {
    const repository = captured();
    progressToInProgress(repository);

    const restored = MissionRepository.fromSnapshot(repository.snapshot());

    expect(restored.snapshot()).toEqual(repository.snapshot());
    expect(restored.promote(binding, evidence("capture"))).toEqual(
      repository.get(binding.missionId),
    );
  });

  it("projects operator truth without private process fields", () => {
    const repository = captured();
    repository.transition(binding.missionId, {
      state: "ROUTED",
      owner: "Brigid",
      evidence: evidence("route"),
      nextAction: "Request a wake receipt",
    });

    const projection = projectMission(repository.get(binding.missionId));

    expect(projection).toEqual({
      missionId: "mission-1",
      state: "ROUTED",
      canonicalPacketId: "LJH-77",
      threadId: "thread-1",
      owner: "Brigid",
      nextAction: "Request a wake receipt",
      lauraNeeded: false,
      evidenceReferences: ["capture-receipt", "route-receipt"],
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /heartbeat|credential|contract|lane|lease/i,
    );
  });
});