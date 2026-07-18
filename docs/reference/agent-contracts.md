# Agent Contracts

The provider-neutral contract layer defines interfaces that all providers must implement. Provider-specific SDK types never cross this boundary.

## Provider identity

```typescript
type AgentProviderId = 'claude' | 'codex';
```

## Provider interface

```typescript
interface AgentProvider {
  readonly id: AgentProviderId;

  // Check whether the provider can accept tasks
  checkAvailability(): Promise<ProviderAvailability>;

  // Start a new provider session
  startTask(input: StartTaskInput, host: AgentRunHost): Promise<ProviderRun>;

  // Continue an existing provider session
  continueTask(input: ContinueTaskInput, host: AgentRunHost): Promise<ProviderRun>;

  // Cancel a running session
  cancelTask(sessionId: string): Promise<void>;

  // Estimate the cost of handoff to another provider
  estimateHandoff(input: HandoffEstimateInput): Promise<HandoffEstimate>;
}
```

## Provider session

```typescript
interface ProviderSession {
  provider: AgentProviderId;  // immutable per task
  sessionId: string;
  createdAt: number;
}

interface ProviderRun {
  session: ProviderSession;    // resolved before awaiting completion
  completion: Promise<TaskResult>;
}
```

## Host interface

The host object is provided by the coordinator to each provider turn:

```typescript
interface AgentRunHost {
  // Emit a normalized event for Discord rendering and persistence
  emit(event: AgentEvent): Promise<void>;

  // Request human approval for a tool or action
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;

  // Request human input for a question
  requestUserInput(request: UserQuestion): Promise<UserAnswer>;
}
```

## Task input

```typescript
interface StartTaskInput {
  taskId: string;
  projectName: string;
  channelId: string;
  threadId: string;
  prompt: string;
  workingDirectory: string;
  settings?: AgentTaskSettings;
  model?: string;                    // legacy, use settings
  reasoningEffort?: ReasoningEffort; // legacy, use settings
}

interface ContinueTaskInput extends StartTaskInput {
  session: ProviderSession;
  turnSettings?: AgentTurnSettings;  // one-turn overrides
}
```

## Settings types

```typescript
interface AgentTaskSettings {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  mcpProfile?: string;
  approvalProfile?: string;
}

interface AgentTurnSettings {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
}

type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
```

## Task statuses

```typescript
type TaskStatus =
  | 'created'
  | 'starting'
  | 'running'
  | 'waiting_for_user'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
```

## Agent events

All provider output is normalized into `AgentEvent` variants:

| Event type | Description |
|---|---|
| `session_started` | Provider session established |
| `text_delta` | Incremental text output |
| `status` | Phase changes (planning, coding, etc.) |
| `plan` | Structured plan with steps |
| `command` | Shell command execution |
| `file_change` | File creation or modification |
| `approval_request` | Tool requires approval |
| `user_question` | Provider asks a question |
| `usage` | Token/rate-limit usage snapshot |
| `completed` | Task completed successfully |
| `failed` | Task failed |

## Result

```typescript
interface TaskResult {
  provider: AgentProviderId;
  outcome: 'completed' | 'failed' | 'cancelled';
  exitType: string;
  startedAt: number;
  completedAt: number;
  summary?: string;
  error?: { type: string; message: string };
  branchName?: string;
  unresolvedDecisions?: ApprovalRequest[];
}
```
