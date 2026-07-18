# Agent Contracts

The provider-neutral contract layer defines the interfaces implemented by Claude, Codex, and OpenCode. Provider SDK and protocol types never cross this boundary.

## Provider identity

```typescript
type AgentProviderId = 'claude' | 'codex' | 'opencode';
```

## Provider interface

```typescript
interface AgentProvider {
  readonly id: AgentProviderId;

  checkAvailability(): Promise<ProviderAvailability>;
  startTask(input: StartTaskInput, host: AgentRunHost): Promise<ProviderRun>;
  continueTask(input: ContinueTaskInput, host: AgentRunHost): Promise<ProviderRun>;
  cancelTask(sessionId: string): Promise<void>;
  estimateHandoff(input: HandoffEstimateInput): Promise<HandoffEstimate>;
}
```

## Provider session and run

```typescript
interface ProviderSession {
  provider: AgentProviderId; // immutable per durable task
  sessionId: string;
  createdAt: number;
}

interface ProviderRun {
  session: ProviderSession; // available before completion is awaited
  completion: Promise<TaskResult>;
}
```

The coordinator persists the provider session immediately after `startTask()` or `continueTask()` returns and before awaiting `completion`.

## Host interface

The coordinator supplies a host object to every provider turn:

```typescript
interface AgentRunHost {
  emit(event: AgentEvent): Promise<void>;
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
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
  settings: AgentTaskSettings;
  model?: string;                    // compatibility mirror of settings.model
  reasoningEffort?: ReasoningEffort; // compatibility mirror of settings.reasoningEffort
}

interface ContinueTaskInput extends StartTaskInput {
  session: ProviderSession;
  turnSettings?: AgentTurnSettings;
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

Provider capability validation currently permits:

| Provider | Task settings | Turn settings |
|---|---|---|
| Claude | `model`, `timeoutMs`, `mcpProfile` | `model`, `timeoutMs` |
| Codex | `model`, `reasoningEffort` | `model`, `reasoningEffort` |
| OpenCode | `model` | `model` |

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

Every provider emits the same `AgentEvent` variants:

| Event type | Description |
|---|---|
| `session_started` | Provider session established |
| `text_delta` | Incremental text output |
| `status` | Phase change or progress detail |
| `plan` | Structured plan items |
| `command` | Command execution and output |
| `file_change` | File creation or modification |
| `approval_request` | Consequential action requires a decision |
| `user_question` | Provider requests user input |
| `usage` | Usage or rate-limit snapshot |
| `completed` | Provider reported completion |
| `failed` | Provider reported failure |

Events and results are redacted before persistence, Discord rendering, and logs.

## Result

```typescript
interface TaskResult {
  provider: AgentProviderId;
  outcome: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  exitType: string;
  startedAt: number;
  completedAt: number;
  sessionId?: string;
  summary?: string;
  usage?: ProviderUsage;
  branchName?: string;
  verification?: string[];
  unresolved?: string[];
  error?: NormalizedAgentError;
}
```
