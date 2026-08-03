INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (1, 1, 2, 'leads_to', 'Within the origin investigation, Operate coding agents from a private Discord workspace created the context for Choose Discord as the remote interaction surface.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (2, 3, 4, 'leads_to', 'Within the discordclaude-poc investigation, Derive the repository from DiscordClaude created the context for DiscordClaude proved remote conversational control.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (3, 4, 5, 'leads_to', 'Within the discordclaude-poc investigation, DiscordClaude proved remote conversational control created the context for The proof of concept did not establish a general runtime.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (4, 6, 29, 'leads_to', 'Within the conversation-identity investigation, Use Discord history as the complete conversation store created the context for Own durable direct-runtime state in SQLite.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (5, 29, 30, 'leads_to', 'Within the conversation-identity investigation, Own durable direct-runtime state in SQLite created the context for Separate internal conversation identity from Discord message identity.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (6, 30, 31, 'leads_to', 'Within the conversation-identity investigation, Separate internal conversation identity from Discord message identity created the context for Keep provider session identity separate from repository conversation state.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (7, 31, 32, 'leads_to', 'Within the conversation-identity investigation, Keep provider session identity separate from repository conversation state created the context for Recover interrupted state without automatic task replay.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (8, 32, 33, 'leads_to', 'Within the conversation-identity investigation, Recover interrupted state without automatic task replay created the context for Restart recovery is not exact-once execution.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (9, 7, 8, 'leads_to', 'Within the provider-neutrality investigation, Revisit Claude-specific bot coupling created the context for Normalize providers behind agent contracts.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (10, 8, 9, 'leads_to', 'Within the provider-neutrality investigation, Normalize providers behind agent contracts created the context for Build the provider-neutral persistence and rendering foundation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (11, 9, 10, 'leads_to', 'Within the provider-neutrality investigation, Build the provider-neutral persistence and rendering foundation created the context for Add Codex App Server and PM support.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (12, 10, 11, 'leads_to', 'Within the provider-neutrality investigation, Add Codex App Server and PM support created the context for Add OpenCode through ACP.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (13, 11, 12, 'leads_to', 'Within the provider-neutrality investigation, Add OpenCode through ACP created the context for Multi-provider orchestration is implemented, not provider sameness.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (14, 13, 14, 'leads_to', 'Within the primary-subagents investigation, Keep one persistent primary PM-style agent created the context for Separate planning authority from coding tools.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (15, 14, 15, 'leads_to', 'Within the primary-subagents investigation, Separate planning authority from coding tools created the context for Represent subagent work as flat channel messages.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (16, 15, 16, 'leads_to', 'Within the primary-subagents investigation, Represent subagent work as flat channel messages created the context for Use Discord threads as task interaction surfaces.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (17, 16, 17, 'leads_to', 'Within the primary-subagents investigation, Use Discord threads as task interaction surfaces created the context for Bind each durable task to one provider session.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (18, 17, 18, 'leads_to', 'Within the primary-subagents investigation, Bind each durable task to one provider session created the context for A Discord thread is not a subagent execution record.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (19, 18, 19, 'leads_to', 'Within the primary-subagents investigation, A Discord thread is not a subagent execution record created the context for Make thread deletion an idempotent cleanup signal.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (20, 20, 21, 'leads_to', 'Within the operator-interface investigation, Use Discord for conversational operator control created the context for Discord is unsuitable as authoritative execution state.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (21, 22, 23, 'leads_to', 'Within the structured-interaction investigation, Use bounded structured controls for operator decisions created the context for Polls are useful inputs, not universal approval ledgers.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (22, 24, 25, 'leads_to', 'Within the notifications investigation, Prefer quiet structured status over message volume created the context for Notifications remain projections rather than durable receipts.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (23, 26, 27, 'leads_to', 'Within the discord-constraints investigation, Discord imposes delivery, size, permission, and interaction constraints created the context for Add capability checks and bounded presentation fallbacks.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (24, 27, 28, 'leads_to', 'Within the discord-constraints investigation, Add capability checks and bounded presentation fallbacks created the context for Gateway exact-once and in-order delivery remain unproven.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (25, 34, 35, 'leads_to', 'Within the repl investigation, A live Discord dependency hindered local debugging and verification created the context for Extract a transport-neutral primary conversation service.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (26, 35, 36, 'leads_to', 'Within the repl investigation, Extract a transport-neutral primary conversation service created the context for Add the local terminal REPL adapter.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (27, 36, 37, 'leads_to', 'Within the repl investigation, Add the local terminal REPL adapter created the context for The REPL is supported but not equivalent to live Discord.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (28, 38, 39, 'leads_to', 'Within the testing investigation, Make core behavior verifiable without live Discord created the context for Add an opt-in headless live-provider smoke path.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (29, 39, 40, 'leads_to', 'Within the testing investigation, Add an opt-in headless live-provider smoke path created the context for Current main passes 829 deterministic tests.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (30, 40, 41, 'leads_to', 'Within the testing investigation, Current main passes 829 deterministic tests created the context for Live Discord verification remains credentialed and opt-in.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (31, 42, 43, 'leads_to', 'Within the execution-boundary investigation, Use TaskCoordinator as authority for direct provider tasks created the context for Keep all future execution authority inside the Discord bot.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (32, 44, 45, 'leads_to', 'Within the factory-floor investigation, Prototype a direct Factory Floor Discord bridge created the context for Correct the Factory Floor integration boundary.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (33, 45, 46, 'leads_to', 'Within the factory-floor investigation, Correct the Factory Floor integration boundary created the context for Keep Factory Floor authoritative for Factory Floor-linked runs.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (34, 46, 47, 'leads_to', 'Within the factory-floor investigation, Keep Factory Floor authoritative for Factory Floor-linked runs created the context for Limit Discord Agent to Activity launch, identity, and linkage.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (35, 47, 48, 'leads_to', 'Within the factory-floor investigation, Limit Discord Agent to Activity launch, identity, and linkage created the context for Add disabled-by-default Factory Floor bindings and clients.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (36, 48, 49, 'leads_to', 'Within the factory-floor investigation, Add disabled-by-default Factory Floor bindings and clients created the context for Implement trusted Activity launch registration.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (37, 49, 50, 'leads_to', 'Within the factory-floor investigation, Implement trusted Activity launch registration created the context for Implement Activity OAuth and session bootstrap broker.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (38, 50, 51, 'leads_to', 'Within the factory-floor investigation, Implement Activity OAuth and session bootstrap broker created the context for Implement fresh principal revalidation for sensitive actions.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (39, 51, 52, 'leads_to', 'Within the factory-floor investigation, Implement fresh principal revalidation for sensitive actions created the context for Activity trust scaffolding exists, but the rich operator console is incomplete.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (40, 52, 53, 'leads_to', 'Within the factory-floor investigation, Activity trust scaffolding exists, but the rich operator console is incomplete created the context for Treat the Discord Activity as a replacement for chat.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (41, 54, 55, 'leads_to', 'Within the authority-security investigation, Authorize transport access through configured guild and roles created the context for Discord transport authorization is not tool authority.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (42, 55, 56, 'leads_to', 'Within the authority-security investigation, Discord transport authorization is not tool authority created the context for Revalidate Activity principals before sensitive mutations.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (43, 56, 57, 'leads_to', 'Within the authority-security investigation, Revalidate Activity principals before sensitive mutations created the context for Centralize redaction and bound Discord-facing output.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (44, 57, 58, 'leads_to', 'Within the authority-security investigation, Centralize redaction and bound Discord-facing output created the context for Untrusted content remains a distinct security risk.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (45, 59, 60, 'leads_to', 'Within the public-readiness investigation, Publish architecture and operations without publishing secrets created the context for The repository is suitable for public source review.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (46, 60, 61, 'leads_to', 'Within the public-readiness investigation, The repository is suitable for public source review created the context for Public and tested does not mean production-ready.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (47, 63, 64, 'leads_to', 'Within the agent-team investigation, Validate effective Agent Team composition created the context for Validated team composition does not prove routed execution.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (48, 65, 66, 'leads_to', 'Within the mission-projection investigation, Persist mission lifecycle and truthful operator projection created the context for Mission projection is not an execution receipt.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (49, 67, 68, 'leads_to', 'Within the execution-migration investigation, Keep the direct provider runtime supported during migration created the context for Migrate execution authority only after verified parity.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (50, 69, 70, 'leads_to', 'Within the portfolio-boundary investigation, Cross-repository authority is scoped, not inherited created the context for The current architecture is a federated authority model.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (51, 1, 3, 'enables', 'The private Discord workspace goal opened the discordclaude-poc line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (52, 1, 6, 'enables', 'The private Discord workspace goal opened the conversation-identity line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (53, 1, 7, 'enables', 'The private Discord workspace goal opened the provider-neutrality line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (54, 1, 13, 'enables', 'The private Discord workspace goal opened the primary-subagents line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (55, 1, 20, 'enables', 'The private Discord workspace goal opened the operator-interface line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (56, 1, 22, 'enables', 'The private Discord workspace goal opened the structured-interaction line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (57, 1, 24, 'enables', 'The private Discord workspace goal opened the notifications line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (58, 1, 26, 'enables', 'The private Discord workspace goal opened the discord-constraints line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (59, 1, 34, 'enables', 'The private Discord workspace goal opened the repl line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (60, 1, 38, 'enables', 'The private Discord workspace goal opened the testing line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (61, 1, 42, 'enables', 'The private Discord workspace goal opened the execution-boundary line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (62, 1, 44, 'enables', 'The private Discord workspace goal opened the factory-floor line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (63, 1, 54, 'enables', 'The private Discord workspace goal opened the authority-security line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (64, 1, 59, 'enables', 'The private Discord workspace goal opened the public-readiness line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (65, 1, 62, 'enables', 'The private Discord workspace goal opened the activity-readiness line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (66, 1, 63, 'enables', 'The private Discord workspace goal opened the agent-team line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (67, 1, 65, 'enables', 'The private Discord workspace goal opened the mission-projection line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (68, 1, 67, 'enables', 'The private Discord workspace goal opened the execution-migration line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (69, 1, 69, 'enables', 'The private Discord workspace goal opened the portfolio-boundary line of investigation.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (70, 2, 3, 'leads_to', 'The preceding findings exposed the need to investigate discordclaude-poc.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (71, 5, 6, 'leads_to', 'The preceding findings exposed the need to investigate conversation-identity.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (72, 33, 7, 'leads_to', 'The preceding findings exposed the need to investigate provider-neutrality.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (73, 12, 13, 'leads_to', 'The preceding findings exposed the need to investigate primary-subagents.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (74, 19, 20, 'leads_to', 'The preceding findings exposed the need to investigate operator-interface.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (75, 21, 22, 'leads_to', 'The preceding findings exposed the need to investigate structured-interaction.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (76, 23, 24, 'leads_to', 'The preceding findings exposed the need to investigate notifications.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (77, 25, 26, 'leads_to', 'The preceding findings exposed the need to investigate discord-constraints.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (78, 28, 34, 'leads_to', 'The preceding findings exposed the need to investigate repl.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (79, 37, 38, 'leads_to', 'The preceding findings exposed the need to investigate testing.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (80, 41, 42, 'leads_to', 'The preceding findings exposed the need to investigate execution-boundary.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (81, 43, 44, 'leads_to', 'The preceding findings exposed the need to investigate factory-floor.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (82, 53, 54, 'leads_to', 'The preceding findings exposed the need to investigate authority-security.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (83, 58, 59, 'leads_to', 'The preceding findings exposed the need to investigate public-readiness.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (84, 61, 62, 'leads_to', 'The preceding findings exposed the need to investigate activity-readiness.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (85, 62, 63, 'leads_to', 'The preceding findings exposed the need to investigate agent-team.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (86, 64, 65, 'leads_to', 'The preceding findings exposed the need to investigate mission-projection.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (87, 66, 67, 'leads_to', 'The preceding findings exposed the need to investigate execution-migration.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (88, 68, 69, 'leads_to', 'The preceding findings exposed the need to investigate portfolio-boundary.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (89, 3, 4, 'enables', 'Derive the repository from DiscordClaude supplied the prerequisite for DiscordClaude proved remote conversational control.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (90, 6, 29, 'enables', 'Use Discord history as the complete conversation store supplied the prerequisite for Own durable direct-runtime state in SQLite.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (91, 29, 30, 'enables', 'Own durable direct-runtime state in SQLite supplied the prerequisite for Separate internal conversation identity from Discord message identity.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (92, 30, 31, 'enables', 'Separate internal conversation identity from Discord message identity supplied the prerequisite for Keep provider session identity separate from repository conversation state.', '2026-08-03T00:00:00Z');

INSERT INTO decision_edges (id, source_node_id, target_node_id, edge_type, rationale, created_at) VALUES (93, 31, 32, 'enables', 'Keep provider session identity separate from repository conversation state supplied the prerequisite for Recover interrupted state without automatic task replay.', '2026-08-03T00:00:00Z');
