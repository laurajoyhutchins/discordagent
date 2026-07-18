# Use the terminal REPL

When Discord Agent is launched from an interactive terminal, it exposes a conversational REPL for the primary PM agent. The REPL runs in the same process as the Discord bot and shares the same runtime, provider registry, project store, memory, task coordinator, and usage admission.

## Starting the REPL

Run the bot normally from an interactive terminal:

```bash
npm run dev
```

The REPL starts automatically after Discord login, runtime initialization, and durable recovery complete. A welcome message appears:

```
Terminal REPL connected. Type /help for commands.
```

## Disabling the REPL

Set the environment variable to prevent the REPL from starting:

```bash
TERMINAL_REPL_ENABLED=false npm run dev
```

The REPL also does not start when stdin or stdout is not a TTY (piped input, CI environments, service managers).

## REPL commands

### `/help`

Display available commands and a reminder that ordinary text is sent to the primary PM agent.

### `/status`

Show concise runtime information: primary provider, terminal project context, active or recent tasks, and runtime state.

### `/projects`

List all registered projects.

### `/project <name>`

Set the terminal's current project context. This is an ephemeral preference that influences how the primary agent interprets prompts. It does not change the parent Discord project configuration or the project's default provider.

### `/provider`

Show the current primary provider.

### `/provider <name>`

Change the primary provider. The provider must be registered on the host and pass its availability check. Valid names: `claude`, `codex`, `opencode`.

### `/model`

Show the active primary-agent model.

### `/model <name>`

Set the primary agent model. This updates the global `primaryAgentModel` setting.

### `/tasks`

List active or recent coordinated tasks using the durable task repository. Does not scrape Discord.

### `/clear`

Clear the terminal display. Does not delete any data (messages, memories, projects, or task records).

### `/exit`

Stop accepting REPL input. The Discord bot continues running. Use `Ctrl+C` for a full process shutdown.

## Conversations with the primary agent

Ordinary text is sent to the primary PM agent through the same conversation service that powers the Discord `#agent-chat` channel. The agent can reply, propose tasks, ask for decisions, and write memory.

### Task proposals

When the agent proposes a task, the REPL shows a numbered choice:

```
[1] Start task
[2] Cancel
```

Enter `1` to start the task. Enter `2` to cancel. The task launches through the Discord bot using the registered project channel.

When the user's input contains explicit intent (`go ahead`, `do it`, `start`, `proceed`, `implement`, `take care of it`), the task starts without an additional confirmation prompt, matching Discord behavior.

### Decisions

The agent can ask for confirmations, selections, or polls.

- **Confirm**: Two numbered options (Yes/No or Proceed/Cancel).
- **Select**: All available options with bounded numbering.
- **Poll**: Rendered as a synchronous numbered selection (not a 24-hour Discord poll). The selected result is passed back through the same decision-continuation path.

Enter a number to select an option, or `q` or `cancel` to dismiss.

### Invalid input

For invalid numbered input the REPL shows a concise error and repeats the choice prompt. It does not silently select the first option.

## Exiting

- `/exit` stops the REPL only. The Discord bot continues running.
- `Ctrl+C` triggers the full process shutdown: REPL stops, loops stop, review sources dispose, runtime stops, Discord client destroys, process exits.

## Conversation identity

The terminal conversation uses the stable identifier `terminal:primary`. This keeps terminal messages in their own visible transcript within the message repository, separate from the Discord primary channel, while sharing durable memory and project context.

## Architecture

The REPL is an adapter over the transport-neutral `PrimaryConversationService`, just as the Discord `#agent-chat` handler is. Both use the same runtime services, provider registry, memory system, and task coordinator. No terminal-specific code duplicates the conversation lifecycle.
