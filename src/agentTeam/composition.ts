export type Revision = number;

export interface AuthoritySet {
  readonly capabilities: readonly string[];
}

export interface ContractReference {
  readonly id: string;
  readonly revision: Revision;
}

export interface AgentIdentity {
  readonly id: string;
  readonly revision: Revision;
  readonly displayName: string;
}

export interface RoleContract {
  readonly id: string;
  readonly revision: Revision;
  readonly identity: ContractReference;
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
  readonly role: ContractReference;
  readonly operatorProfile: ContractReference;
  readonly allowedCapabilities: readonly string[];
}

export interface DiscordBinding {
  readonly id: string;
  readonly revision: Revision;
  readonly identity: ContractReference;
  readonly assignment: ContractReference;
  readonly eligibleCapabilities: readonly string[];
}

export interface RuntimeSafetyPolicy {
  readonly revision: Revision;
  readonly allowedCapabilities: readonly string[];
}

export interface TeamTopologyMember {
  readonly identity: ContractReference;
  readonly role: ContractReference;
  readonly assignment: ContractReference;
  readonly binding: ContractReference;
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

function requireReference<T extends { readonly id: string; readonly revision: Revision }>(
  kind: string,
  ownerId: string,
  referenceKind: string,
  reference: ContractReference,
  index: ReadonlyMap<string, T>,
): T {
  requirePositiveRevision(
    `${kind} ${ownerId} ${referenceKind} reference`,
    reference.id,
    reference.revision,
  );
  const value = index.get(reference.id);
  if (value === undefined) {
    throw new AgentTeamConfigurationError(
      `${kind} ${ownerId} references missing ${referenceKind} ${reference.id}`,
    );
  }
  if (value.revision !== reference.revision) {
    throw new AgentTeamConfigurationError(
      `${kind} ${ownerId} references stale ${referenceKind} ${reference.id} revision ${reference.revision}; current revision is ${value.revision}`,
    );
  }
  return value;
}

export function composeEffectiveAgents(
  configuration: AgentTeamConfiguration,
): readonly EffectiveAgent[] {
  requirePositiveRevision(
    "team topology",
    configuration.topology.id,
    configuration.topology.revision,
  );
  requirePositiveRevision(
    "runtime safety policy",
    "runtime",
    configuration.runtimeSafety.revision,
  );

  const identities = indexUnique("identity", configuration.identities);
  const roles = indexUnique("role", configuration.roles);
  const operatorProfiles = indexUnique(
    "operator profile",
    configuration.operatorProfiles,
  );
  const assignments = indexUnique("assignment", configuration.assignments);
  const bindings = indexUnique("Discord binding", configuration.bindings);

  const runtimeCapabilities = normalizedCapabilities(
    "runtime safety policy",
    "runtime",
    configuration.runtimeSafety.allowedCapabilities,
  );

  const roleCapabilities = new Map<string, Set<string>>();
  for (const role of roles.values()) {
    requireReference("role", role.id, "identity", role.identity, identities);
    roleCapabilities.set(
      role.id,
      normalizedCapabilities("role", role.id, role.authority.capabilities),
    );
  }

  const operatorCapabilities = new Map<string, Set<string>>();
  for (const operatorProfile of operatorProfiles.values()) {
    operatorCapabilities.set(
      operatorProfile.id,
      normalizedCapabilities(
        "operator profile",
        operatorProfile.id,
        operatorProfile.eligibleCapabilities ?? [],
      ),
    );
  }

  const assignmentCapabilities = new Map<string, Set<string>>();
  for (const assignment of assignments.values()) {
    const role = requireReference(
      "assignment",
      assignment.id,
      "role",
      assignment.role,
      roles,
    );
    const operatorProfile = requireReference(
      "assignment",
      assignment.id,
      "operator profile",
      assignment.operatorProfile,
      operatorProfiles,
    );
    const roleAuthority = roleCapabilities.get(role.id)!;
    const operatorAuthority = operatorCapabilities.get(operatorProfile.id)!;
    const assignmentAuthority = normalizedCapabilities(
      "assignment",
      assignment.id,
      assignment.allowedCapabilities,
    );
    assertSubset(
      "operator profile",
      operatorProfile.id,
      operatorAuthority,
      roleAuthority,
    );
    assertSubset("assignment", assignment.id, assignmentAuthority, roleAuthority);
    assignmentCapabilities.set(assignment.id, assignmentAuthority);
  }

  const bindingCapabilities = new Map<string, Set<string>>();
  for (const binding of bindings.values()) {
    const identity = requireReference(
      "Discord binding",
      binding.id,
      "identity",
      binding.identity,
      identities,
    );
    const assignment = requireReference(
      "Discord binding",
      binding.id,
      "assignment",
      binding.assignment,
      assignments,
    );
    const role = requireReference(
      "assignment",
      assignment.id,
      "role",
      assignment.role,
      roles,
    );
    if (role.identity.id !== identity.id) {
      throw new AgentTeamConfigurationError(
        `Discord binding ${binding.id} conflicts with assignment ${assignment.id}`,
      );
    }
    const bindingAuthority = normalizedCapabilities(
      "Discord binding",
      binding.id,
      binding.eligibleCapabilities,
    );
    assertSubset(
      "Discord binding",
      binding.id,
      bindingAuthority,
      roleCapabilities.get(role.id)!,
    );
    bindingCapabilities.set(binding.id, bindingAuthority);
  }

  const topologyIdentityIds = new Set<string>();
  const topologyBindingIds = new Set<string>();

  return configuration.topology.members.map((member) => {
    if (topologyIdentityIds.has(member.identity.id)) {
      throw new AgentTeamConfigurationError(
        `team topology repeats identity ${member.identity.id}`,
      );
    }
    if (topologyBindingIds.has(member.binding.id)) {
      throw new AgentTeamConfigurationError(
        `team topology repeats Discord binding ${member.binding.id}`,
      );
    }
    topologyIdentityIds.add(member.identity.id);
    topologyBindingIds.add(member.binding.id);

    const identity = requireReference(
      "team topology",
      configuration.topology.id,
      "identity",
      member.identity,
      identities,
    );
    const role = requireReference(
      "team topology",
      configuration.topology.id,
      "role",
      member.role,
      roles,
    );
    const assignment = requireReference(
      "team topology",
      configuration.topology.id,
      "assignment",
      member.assignment,
      assignments,
    );
    const binding = requireReference(
      "team topology",
      configuration.topology.id,
      "Discord binding",
      member.binding,
      bindings,
    );
    const operatorProfile = requireReference(
      "assignment",
      assignment.id,
      "operator profile",
      assignment.operatorProfile,
      operatorProfiles,
    );

    if (role.identity.id !== identity.id) {
      throw new AgentTeamConfigurationError(
        `role ${role.id} is bound to identity ${role.identity.id}, not ${identity.id}`,
      );
    }
    if (assignment.role.id !== role.id) {
      throw new AgentTeamConfigurationError(
        `assignment ${assignment.id} is bound to role ${assignment.role.id}, not ${role.id}`,
      );
    }
    if (
      binding.identity.id !== identity.id ||
      binding.assignment.id !== assignment.id
    ) {
      throw new AgentTeamConfigurationError(
        `Discord binding ${binding.id} conflicts with topology member ${identity.id}`,
      );
    }

    const effective = [
      operatorCapabilities.get(operatorProfile.id)!,
      assignmentCapabilities.get(assignment.id)!,
      bindingCapabilities.get(binding.id)!,
      runtimeCapabilities,
    ].reduce(intersect, roleCapabilities.get(role.id)!);

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
