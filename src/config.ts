import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

/**
 * Load MCP server configs from the user's ~/.claude/settings.json.
 * Returns the mcpServers record if found, typed for the Agent SDK.
 */
function loadUserMcpServers(): Record<string, McpServerConfig> | undefined {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    if (settings.mcpServers && typeof settings.mcpServers === 'object') {
      const count = Object.keys(settings.mcpServers).length;
      if (count > 0) {
        console.log(`[config] Loaded ${count} MCP server(s) from ~/.claude/settings.json: ${Object.keys(settings.mcpServers).join(', ')}`);
        return settings.mcpServers as Record<string, McpServerConfig>;
      }
    }
  } catch {
    // No settings file or invalid JSON — that's fine
  }
  return undefined;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),
  authorizedRoleIds: required('AUTHORIZED_ROLE_IDS').split(',').map(s => s.trim()),
  notifyUserId: process.env.NOTIFY_USER_ID ?? '',
  claudeTimeoutMs: parseInt(process.env.CLAUDE_TIMEOUT_MS ?? '900000', 10),
  roborevCliPath: process.env.ROBOREV_CLI_PATH ?? 'roborev',
  projectsBaseDir: process.env.PROJECTS_BASE_DIR ?? '',
  allowNonGit: process.env.ALLOW_NON_GIT === 'true',
  mcpServers: loadUserMcpServers(),
} as const;
