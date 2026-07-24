import { describe, expect, it } from "vitest";

import {
  AgentTeamConfigurationError,
  composeEffectiveAgents,
  type AgentTeamConfiguration,
} from "./composition.js";

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
      identityId: identity.id,
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
      roleId: `role-${index + 1}`,
      operatorProfileId: "operator-default",
      allowedCapabilities: ["read", "propose"],
    })),
    bindings: identities.map((identity, index) => ({
      id: `binding-${index + 1}`,
      revision: 1,
      identityId: identity.id,
      assignmentId: `assignment-${index + 1}`,
      eligibleCapabilities: ["read"],
    })),
    topology: {
      id: "team",
      revision: 1,
      members: identities.map((identity, index) => ({
        identityId: identity.id,
        roleId: `role-${index + 1}`,
        assignmentId: `assignment-${index + 1}`,
        bindingId: `binding-${index + 1}`,
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
    input.topology.members[0] = {
      ...input.topology.members[0],
      roleId: "missing-role",
    };

    expect(() => composeEffectiveAgents(input)).toThrow(
      "references missing role missing-role",
    );
  });

  it("rejects duplicate stable ids", () => {
    const input = configuration(2);
    input.identities[1] = { ...input.identities[1], id: "agent-1" };

    expect(() => composeEffectiveAgents(input)).toThrow("duplicate identity id");
  });

  it("rejects invalid revisions", () => {
    const input = configuration();
    input.assignments[0] = { ...input.assignments[0], revision: 0 };

    expect(() => composeEffectiveAgents(input)).toThrow("invalid revision 0");
  });

  it("rejects attempted authority broadening", () => {
    const input = configuration();
    input.bindings[0] = {
      ...input.bindings[0],
      eligibleCapabilities: ["read", "delete-repository"],
    };

    expect(() => composeEffectiveAgents(input)).toThrow(
      "attempts to broaden authority",
    );
  });

  it("uses a fail-closed safe default when operator eligibility is omitted", () => {
    const input = configuration();
    input.operatorProfiles[0] = {
      id: "operator-default",
      revision: 1,
    };

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
    input.bindings[1] = {
      ...input.bindings[1],
      assignmentId: "assignment-1",
    };

    expect(() => composeEffectiveAgents(input)).toThrow(
      AgentTeamConfigurationError,
    );
  });
});
