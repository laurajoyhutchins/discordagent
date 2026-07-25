export type MissionState =
  | "CAPTURED"
  | "ROUTED"
  | "AWAITING_CLAIM"
  | "CLAIMED"
  | "IN_PROGRESS"
  | "VERIFIED"
  | "CHANGES_REQUESTED"
  | "AWAITING_LAURA"
  | "DONE"
  | "CANCELLED";

export type MissionEvidenceKind =
  | "capture"
  | "route"
  | "wake"
  | "claim"
  | "execution"
  | "verification"
  | "completion"
  | "cancellation"
  | "reroute";

export interface MissionEvidence {
  kind: MissionEvidenceKind;
  reference: string;
  recordedAt: string;
}

export interface MissionBinding {
  missionId: string;
  promotionIdempotencyKey: string;
  discordSourceMessageId: string;
  discordMissionThreadId: string;
  canonicalPacketId: string;
}

export interface MissionRecord extends MissionBinding {
  state: MissionState;
  currentOwner?: string;
  evidence: readonly MissionEvidence[];
  blocker?: string;
  retryTrigger?: string;
  nextAction?: string;
  lauraNeeded: boolean;
}

export interface MissionSnapshot {
  version: 1;
  missions: readonly MissionRecord[];
}

export interface MissionProjection {
  missionId: string;
  state: MissionState;
  canonicalPacketId: string;
  threadId: string;
  owner?: string;
  blocker?: string;
  retryTrigger?: string;
  nextAction?: string;
  lauraNeeded: boolean;
  evidenceReferences: readonly string[];
}

export class MissionConflictError extends Error {}
export class MissionTransitionError extends Error {}

const cloneMission = (mission: MissionRecord): MissionRecord => ({
  ...mission,
  evidence: mission.evidence.map((item) => ({ ...item })),
});

const evidenceKinds = (mission: MissionRecord): ReadonlySet<MissionEvidenceKind> =>
  new Set(mission.evidence.map((item) => item.kind));

const requireEvidence = (
  mission: MissionRecord,
  ...required: MissionEvidenceKind[]
): void => {
  const present = evidenceKinds(mission);
  const missing = required.filter((kind) => !present.has(kind));
  if (missing.length > 0) {
    throw new MissionTransitionError(
      `${mission.state} requires evidence: ${missing.join(", ")}`,
    );
  }
};

const validateRecord = (mission: MissionRecord): void => {
  if (!mission.missionId || !mission.promotionIdempotencyKey) {
    throw new MissionTransitionError("Mission identity must be nonempty");
  }

  if (!mission.discordSourceMessageId || !mission.discordMissionThreadId) {
    throw new MissionTransitionError(
      "Captured missions require source-message and mission-thread references",
    );
  }

  if (!mission.canonicalPacketId) {
    throw new MissionTransitionError(
      "Captured missions require a canonical packet reference",
    );
  }

  requireEvidence(mission, "capture");

  switch (mission.state) {
    case "CAPTURED":
      return;
    case "ROUTED":
      if (!mission.currentOwner) {
        throw new MissionTransitionError("ROUTED requires a selected owner");
      }
      requireEvidence(mission, "route");
      return;
    case "AWAITING_CLAIM":
      if (!mission.currentOwner) {
        throw new MissionTransitionError("AWAITING_CLAIM requires a selected owner");
      }
      requireEvidence(mission, "route", "wake");
      return;
    case "CLAIMED":
      if (!mission.currentOwner) {
        throw new MissionTransitionError("CLAIMED requires a current owner");
      }
      requireEvidence(mission, "route", "wake", "claim");
      return;
    case "IN_PROGRESS":
      if (!mission.currentOwner) {
        throw new MissionTransitionError("IN_PROGRESS requires a current owner");
      }
      requireEvidence(mission, "route", "wake", "claim", "execution");
      return;
    case "VERIFIED":
    case "CHANGES_REQUESTED":
    case "AWAITING_LAURA":
      requireEvidence(
        mission,
        "route",
        "wake",
        "claim",
        "execution",
        "verification",
      );
      return;
    case "DONE":
      requireEvidence(
        mission,
        "route",
        "wake",
        "claim",
        "execution",
        "verification",
        "completion",
      );
      return;
    case "CANCELLED":
      requireEvidence(mission, "cancellation");
      return;
  }
};

const allowedTransitions: Readonly<Record<MissionState, readonly MissionState[]>> = {
  CAPTURED: ["ROUTED", "CANCELLED"],
  ROUTED: ["AWAITING_CLAIM", "ROUTED", "CANCELLED"],
  AWAITING_CLAIM: ["CLAIMED", "ROUTED", "CANCELLED"],
  CLAIMED: ["IN_PROGRESS", "ROUTED", "CANCELLED"],
  IN_PROGRESS: ["VERIFIED", "CHANGES_REQUESTED", "AWAITING_LAURA", "CANCELLED"],
  VERIFIED: ["DONE", "CHANGES_REQUESTED", "AWAITING_LAURA", "CANCELLED"],
  CHANGES_REQUESTED: ["IN_PROGRESS", "ROUTED", "CANCELLED"],
  AWAITING_LAURA: ["DONE", "CHANGES_REQUESTED", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

export interface MissionTransition {
  state: MissionState;
  owner?: string;
  evidence?: MissionEvidence;
  blocker?: string;
  retryTrigger?: string;
  nextAction?: string;
  lauraNeeded?: boolean;
}

export class MissionRepository {
  private readonly missionsById = new Map<string, MissionRecord>();
  private readonly missionIdByPromotionKey = new Map<string, string>();
  private readonly missionIdBySourceMessage = new Map<string, string>();
  private readonly missionIdByThread = new Map<string, string>();

  static fromSnapshot(snapshot: MissionSnapshot): MissionRepository {
    if (snapshot.version !== 1) {
      throw new MissionConflictError(`Unsupported mission snapshot version: ${snapshot.version}`);
    }

    const repository = new MissionRepository();
    for (const mission of snapshot.missions) {
      validateRecord(mission);
      repository.insert(cloneMission(mission));
    }
    return repository;
  }

  promote(binding: MissionBinding, captureEvidence: MissionEvidence): MissionRecord {
    if (captureEvidence.kind !== "capture") {
      throw new MissionTransitionError("Promotion requires capture evidence");
    }

    const existingMissionId = this.resolveExistingMissionId(binding);
    if (existingMissionId) {
      const existing = this.get(existingMissionId);
      if (!this.sameBinding(existing, binding)) {
        throw new MissionConflictError(
          "Promotion interaction, source message, or mission thread is already bound differently",
        );
      }
      return existing;
    }

    const mission: MissionRecord = {
      ...binding,
      state: "CAPTURED",
      evidence: [{ ...captureEvidence }],
      lauraNeeded: false,
    };
    validateRecord(mission);
    this.insert(mission);
    return cloneMission(mission);
  }

  transition(missionId: string, transition: MissionTransition): MissionRecord {
    const current = this.get(missionId);
    if (!allowedTransitions[current.state].includes(transition.state)) {
      throw new MissionTransitionError(
        `Illegal mission transition: ${current.state} -> ${transition.state}`,
      );
    }

    const nextEvidence = transition.evidence
      ? [...current.evidence, { ...transition.evidence }]
      : [...current.evidence];

    const next: MissionRecord = {
      ...current,
      state: transition.state,
      currentOwner: transition.owner ?? current.currentOwner,
      evidence: nextEvidence,
      blocker: transition.blocker,
      retryTrigger: transition.retryTrigger,
      nextAction: transition.nextAction,
      lauraNeeded: transition.lauraNeeded ?? false,
    };

    if (transition.state === "ROUTED" && current.state !== "CAPTURED") {
      if (transition.evidence?.kind !== "reroute") {
        throw new MissionTransitionError("Re-routing requires reroute evidence");
      }
      next.evidence = [...current.evidence, { ...transition.evidence }];
    }

    validateRecord(next);
    this.missionsById.set(missionId, cloneMission(next));
    return cloneMission(next);
  }

  get(missionId: string): MissionRecord {
    const mission = this.missionsById.get(missionId);
    if (!mission) {
      throw new MissionConflictError(`Unknown mission: ${missionId}`);
    }
    return cloneMission(mission);
  }

  snapshot(): MissionSnapshot {
    return {
      version: 1,
      missions: [...this.missionsById.values()]
        .map(cloneMission)
        .sort((left, right) => left.missionId.localeCompare(right.missionId)),
    };
  }

  private resolveExistingMissionId(binding: MissionBinding): string | undefined {
    const candidates = new Set(
      [
        this.missionIdByPromotionKey.get(binding.promotionIdempotencyKey),
        this.missionIdBySourceMessage.get(binding.discordSourceMessageId),
        this.missionIdByThread.get(binding.discordMissionThreadId),
      ].filter((value): value is string => Boolean(value)),
    );

    if (candidates.size > 1) {
      throw new MissionConflictError("Mission binding indexes disagree");
    }
    return candidates.values().next().value;
  }

  private sameBinding(existing: MissionRecord, binding: MissionBinding): boolean {
    return (
      existing.missionId === binding.missionId &&
      existing.promotionIdempotencyKey === binding.promotionIdempotencyKey &&
      existing.discordSourceMessageId === binding.discordSourceMessageId &&
      existing.discordMissionThreadId === binding.discordMissionThreadId &&
      existing.canonicalPacketId === binding.canonicalPacketId
    );
  }

  private insert(mission: MissionRecord): void {
    if (this.missionsById.has(mission.missionId)) {
      throw new MissionConflictError(`Duplicate mission ID: ${mission.missionId}`);
    }

    for (const [index, key] of [
      [this.missionIdByPromotionKey, mission.promotionIdempotencyKey],
      [this.missionIdBySourceMessage, mission.discordSourceMessageId],
      [this.missionIdByThread, mission.discordMissionThreadId],
    ] as const) {
      if (index.has(key)) {
        throw new MissionConflictError(`Duplicate mission binding: ${key}`);
      }
      index.set(key, mission.missionId);
    }

    this.missionsById.set(mission.missionId, cloneMission(mission));
  }
}

export const projectMission = (mission: MissionRecord): MissionProjection => ({
  missionId: mission.missionId,
  state: mission.state,
  canonicalPacketId: mission.canonicalPacketId,
  threadId: mission.discordMissionThreadId,
  ...(mission.currentOwner ? { owner: mission.currentOwner } : {}),
  ...(mission.blocker ? { blocker: mission.blocker } : {}),
  ...(mission.retryTrigger ? { retryTrigger: mission.retryTrigger } : {}),
  ...(mission.nextAction ? { nextAction: mission.nextAction } : {}),
  lauraNeeded: mission.lauraNeeded,
  evidenceReferences: mission.evidence.map((item) => item.reference),
});
