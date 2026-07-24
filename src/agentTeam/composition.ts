export type Revision = number;

export interface AuthoritySet {
  readonly capabilities: readonly string[];
}

export interface AgentIdentity {
  readonly id: string;
  readonly revision: Revision;
  readonly displayName: string;
}

export interface RoleContract {
  readonly id: string;
  readonly revision: Revision;
  readonly identityId: string;
  readonly authority: AuthoritySet;
}

export interface OperatorProfile {
  readonly id: string;
  readonly revision: Revision;
  readonly eligibleCapabilities?: readonly string[];
  readonly preferences?: Readonly<Record<string, unknown>>;
}

export interface AssignmentContext {
  readonly id: string;
  readonly revision: Revision;
  readonly roleId: string;
  readonly operatorProfileId: string;
  readonly allowedCapabilities: readonly string[];
}

export interface DiscordBinding {
  readonly id: string;
  readonly revision: Revision;
  readonly identityId: string;
  readonly assignmentId: string;
  readonly eligibleCapabilities: readonly string[];
}

export interface RuntimeSafetyPolicy {
  readonly revision: Revision;
  readonly allowedCapabilities: readonly string[];
}

export interface TeamTopologyMember {
  readonly identityId: string;
  readonly roleId: string;
  readonly assignmentId: string;
  readonly bindingId: string;
}

export interface TeamTopology {
  readonly id: string;
  readonly revision: Revision;
  readonly members: readonly TeamTopologyMember[];
}

export interface AgentTeamConfiguration {
  readonly identities: readonly AgentIdentity[];
  readonly roles: readonly RoleContract[];
  readonly operatorProfiles: readonly OperatorProfile[];
  readonly assignments: readonly AssignmentContext[];
  readonly bindings: readonly DiscordBinding[];
  readonly topology: TeamTopology;
  readonly runtimeSafety: RuntimeSafetyPolicy;
}

export interface EffectiveAgent {
  readonly identity: AgentIdentity;
  readonly role: RoleContract;
  readonly operatorProfile: OperatorProfile;
  readonly assignment: AssignmentContext;
  readonly binding: DiscordBinding;
  readonly effectiveAuthority: AuthoritySet;
}

export class AgentTeamConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AgentTeamConfigurationError";
  }
}

function requirePositiveRevision(kind: string, id: string, revision: Revision): void {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new AgentTeamConfigurationError(`${kind} ${id} has invalid revision ${revision}`);
  }
}

function indexUnique<T extends { readonly id: string; readonly revision: Revision }>(
  kind: string,
  values: readonly T[],
): Map<string, T> {
  const result = new Map<string, T>();

  for (const value of values) {
    if (value.id.trim().length === 0) {
      throw new AgentTeamConfigurationError(`${kind} has an empty stable id`);
    }
    requirePositiveRevision(kind, value.id, value.revision);
    if (result.has(value.id)) {
      throw new AgentTeamConfigurationError(`duplicate ${kind} id: ${value.id}`);
    }
    result.set(value.id, value);
  }

  return result;
}

function normalizedCapabilities(
  kind: string,
  id: string,
  capabilities: readonly string[],
): Set<string> {
  const result = new Set<string>();
  for (const capability of capabilities) {
    const normalized = capability.trim();
    if (normalized.length === 0) {
      throw new AgentTeamConfigurationError(`${kind} ${id} has an empty capability`);
    }
    if (result.has(normalized)) {
      throw new AgentTeamConfigurationError(
        `${kind} ${id} repeats capability ${normalized}`,
      );
    }
    result.add(normalized);
  }
  return result;
}

function intersect(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left].filter((value) => right.has(value)));
}

function assertSubset(
  kind: string,
  id: string,
  candidate: Set<string>,
  authorityCeiling: Set<string>,
): void {
  const broadened = [...candidate].filter((value) => !authorityCeiling.has(value));
  if (broadened.length > 0) {
    throw new AgentTeamConfigurationError(
      `${kind} ${id} attempts to broaden authority with: ${broadened.sort().join(", ")}`,
    );
  }
}

function requireReference<T>(
  kind: string,
  ownerId: string,
  referenceKind: string,
  referenceId: string,
  index: ReadonlyMap<string, T>,
): T {
  const value = index.get(referenceId);
  if (value === undefined) {
    throw new AgentTeamConfigurationError(
      `${kind} ${ownerId} references missing ${referenceKind} ${referenceId}`,
    );
  }
  return value;
}

export function composeEffectiveAgents(
  configuration: AgentTeamConfiguration,
): readonly EffectiveAgent[] {
  requirePositiveRevision("team topology", configuration.topology.id, configuration.topology.revision);
  requirePositiveRevision("runtime safety policy", "runtime", configuration.runtimeSafety.revision);

  const identities = indexUnique("identity", configuration.identities);
  const roles = indexUnique("role", configuration.roles);
  const operatorProfiles = indexUnique("operator profile", configuration.operatorProfiles);
  const assignments = indexUnique("assignment", configuration.assignments);
  const bindings = indexUnique("Discord binding", configuration.bindings);

  const runtimeCapabilities = normalizedCapabilities(
    "runtime safety policy",
    "runtime",
    configuration.runtimeSafety.allowedCapabilities,
  );

  const topologyIdentityIds = new Set<string>();
  const topologyBindingIds = new Set<string>();

  return configuration.topology.members.map((member) => {
    if (topologyIdentityIds.has(member.identityId)) {
      throw new AgentTeamConfigurationError(
        `team topology repeats identity ${member.identityId}`,
      );
    }
    if (topologyBindingIds.has(member.bindingId)) {
      throw new AgentTeamConfigurationError(
        `team topology repeats Discord binding ${member.bindingId}`,
      );
    }
    topologyIdentityIds.add(member.identityId);
    topologyBindingIds.add(member.bindingId);

    const identity = requireReference(
      "team topology",
      configuration.topology.id,
      "identity",
      member.identityId,
      identities,
    );
    const role = requireReference(
      "team topology",
      configuration.topology.id,
      "role",
      member.roleId,
      roles,
    );
    const assignment = requireReference(
      "team topology",
      configuration.topology.id,
      "assignment",
      member.assignmentId,
      assignments,
    );
    const binding = requireReference(
      "team topology",
      configuration.topology.id,
      "Discord binding",
      member.bindingId,
      bindings,
    );
    const operatorProfile = requireReference(
      "assignment",
      assignment.id,
      "operator profile",
      assignment.operatorProfileId,
      operatorProfiles,
    );

    if (role.identityId !== identity.id) {
      throw new AgentTeamConfigurationError(
        `role ${role.id} is bound to identity ${role.identityId}, not ${identity.id}`,
      );
    }
    if (assignment.roleId !== role.id) {
      throw new AgentTeamConfigurationError(
        `assignment ${assignment.id} is bound to role ${assignment.roleId}, not ${role.id}`,
      );
    }
    if (binding.identityId !== identity.id || binding.assignmentId !== assignment.id) {
      throw new AgentTeamConfigurationError(
        `Discord binding ${binding.id} conflicts with topology member ${identity.id}`,
      );
    }

    const roleCapabilities = normalizedCapabilities(
      "role",
      role.id,
      role.authority.capabilities,
    );
    const operatorCapabilities = normalizedCapabilities(
      "operator profile",
      operatorProfile.id,
      operatorProfile.eligibleCapabilities ?? [],
    );
    const assignmentCapabilities = normalizedCapabilities(
      "assignment",
      assignment.id,
      assignment.allowedCapabilities,
    );
    const bindingCapabilities = normalizedCapabilities(
      "Discord binding",
      binding.id,
      binding.eligibleCapabilities,
    );

    assertSubset("operator profile", operatorProfile.id, operatorCapabilities, roleCapabilities);
    assertSubset("assignment", assignment.id, assignmentCapabilities, roleCapabilities);
    assertSubset("Discord binding", binding.id, bindingCapabilities, roleCapabilities);

    const effective = [
      operatorCapabilities,
      assignmentCapabilities,
      bindingCapabilities,
      runtimeCapabilities,
    ].reduce(intersect, roleCapabilities);

    return {
      identity,
      role,
      operatorProfile,
      assignment,
      binding,
      effectiveAuthority: { capabilities: [...effective].sort() },
    };
  });
}
