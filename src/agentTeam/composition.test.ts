import { describe, expect, it } from "vitest";

import {
  AgentTeamConfigurationError,
  composeEffectiveAgents,
  type AgentTeamConfiguration,
} from "./composition.js";

function replaceAt<T>(values: readonly T[], index: number, value: T): void {
  (values as T[])[index] = value;
}

function reference(id: string, revision = 1) {
  return { id, revision };
}

function configuration(memberCount = 1): AgentTeamConfiguration {
  const identities = Array.from({ length: memberCount }, (_, index) => ({
    id: `agent-${index + 1}`,
    revision: 1,
    displayName: `Agent ${index + 1}`,
  }));

  return {
    identities,
    roles: identities.map((identity, index) => ({
      id: `role-${index + 1}`,
      revision: 1,
      identity: reference(identity.id, identity.revision),
      authority: { capabilities: ["read", "propose", "admin"] },
    })),
    operatorProfiles: [
      {
        id: "operator-default",
        revision: 1,
        eligibleCapabilities: ["read", "propose"],
        preferences: { verbosity: "concise" },
      },
    ],
    assignments: identities.map((_, index) => ({
      id: `assignment-${index + 1}`,
      revision: 1,
      role: reference(`role-${index + 1}`),
      operatorProfile: reference("operator-default"),
      allowedCapabilities: ["read", "propose"],
    })),
    bindings: identities.map((identity, index) => ({
      id: `binding-${index + 1}`,
      revision: 1,
      identity: reference(identity.id, identity.revision),
      assignment: reference(`assignment-${index + 1}`),
      eligibleCapabilities: ["read"],
    })),
    topology: {
      id: "team",
      revision: 1,
      members: identities.map((identity, index) => ({
        identity: reference(identity.id, identity.revision),
        role: reference(`role-${index + 1}`),
        assignment: reference(`assignment-${index + 1}`),
        binding: reference(`binding-${index + 1}`),
      })),
    },
    runtimeSafety: {
      revision: 1,
      allowedCapabilities: ["read", "propose"],
    },
  };
}

describe("composeEffectiveAgents", () => {
  it("composes effective authority as an intersection", () => {
    const [agent] = composeEffectiveAgents(configuration());

    expect(agent?.effectiveAuthority.capabilities).toEqual(["read"]);
    expect(agent?.operatorProfile.preferences).toEqual({ verbosity: "concise" });
  });

  it("fails closed for broken references", () => {
    const input = configuration();
    replaceAt(input.topology.members, 0, {
      ...input.topology.members[0]!,
      role: reference("missing-role"),
    });

    expect(() => composeEffectiveAgents(input)).toThrow(
      "references missing role missing-role",
    );
  });

  it("rejects duplicate stable ids", () => {
    const input = configuration(2);
    replaceAt(input.identities, 1, { ...input.identities[1]!, id: "agent-1" });

    expect(() => composeEffectiveAgents(input)).toThrow("duplicate identity id");
  });

  it("rejects invalid revisions", () => {
    const input = configuration();
    replaceAt(input.assignments, 0, { ...input.assignments[0]!, revision: 0 });

    expect(() => composeEffectiveAgents(input)).toThrow("invalid revision 0");
  });

  it("rejects stale referenced revisions", () => {
    const input = configuration();
    replaceAt(input.topology.members, 0, {
      ...input.topology.members[0]!,
      role: reference("role-1", 2),
    });

    expect(() => composeEffectiveAgents(input)).toThrow(
      "references stale role role-1 revision 2; current revision is 1",
    );
  });

  it("rejects attempted authority broadening", () => {
    const input = configuration();
    replaceAt(input.bindings, 0, {
      ...input.bindings[0]!,
      eligibleCapabilities: ["read", "delete-repository"],
    });

    expect(() => composeEffectiveAgents(input)).toThrow(
      "attempts to broaden authority",
    );
  });

  it("uses a fail-closed safe default when operator eligibility is omitted", () => {
    const input = configuration();
    replaceAt(input.operatorProfiles, 0, {
      id: "operator-default",
      revision: 1,
    });

    const [agent] = composeEffectiveAgents(input);
    expect(agent?.effectiveAuthority.capabilities).toEqual([]);
  });

  it("adds a sixth agent through configuration only", () => {
    const agents = composeEffectiveAgents(configuration(6));

    expect(agents).toHaveLength(6);
    expect(agents[5]?.identity.id).toBe("agent-6");
    expect(agents[5]?.effectiveAuthority.capabilities).toEqual(["read"]);
  });

  it("rejects a Discord binding that conflicts with stable topology ids", () => {
    const input = configuration(2);
    replaceAt(input.bindings, 1, {
      ...input.bindings[1]!,
      assignment: reference("assignment-1"),
    });

    expect(() => composeEffectiveAgents(input)).toThrow(
      AgentTeamConfigurationError,
    );
  });

  it("rejects an orphan assignment with a missing reference", () => {
    const input = configuration();
    (input.assignments as typeof input.assignments[number][]).push({
      id: "orphan-assignment",
      revision: 1,
      role: reference("missing-role"),
      operatorProfile: reference("operator-default"),
      allowedCapabilities: ["read"],
    });

    expect(() => composeEffectiveAgents(input)).toThrow(
      "assignment orphan-assignment references missing role missing-role",
    );
  });

  it("rejects an orphan role with a stale identity reference", () => {
    const input = configuration();
    (input.roles as typeof input.roles[number][]).push({
      id: "orphan-role",
      revision: 1,
      identity: reference("agent-1", 2),
      authority: { capabilities: ["read"] },
    });

    expect(() => composeEffectiveAgents(input)).toThrow(
      "role orphan-role references stale identity agent-1 revision 2",
    );
  });

  it("rejects an orphan binding that conflicts with its assignment", () => {
    const input = configuration(2);
    (input.bindings as typeof input.bindings[number][]).push({
      id: "orphan-binding",
      revision: 1,
      identity: reference("agent-1"),
      assignment: reference("assignment-2"),
      eligibleCapabilities: ["read"],
    });

    expect(() => composeEffectiveAgents(input)).toThrow(
      "Discord binding orphan-binding conflicts with assignment assignment-2",
    );
  });

  it("rejects authority broadening in an orphan binding", () => {
    const input = configuration();
    (input.bindings as typeof input.bindings[number][]).push({
      id: "orphan-binding",
      revision: 1,
      identity: reference("agent-1"),
      assignment: reference("assignment-1"),
      eligibleCapabilities: ["delete-repository"],
    });

    expect(() => composeEffectiveAgents(input)).toThrow(
      "Discord binding orphan-binding attempts to broaden authority",
    );
  });
});
