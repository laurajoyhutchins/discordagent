import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return productionTypeScriptFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('complete provider-neutral workspace architecture', () => {
  it('removes obsolete Claude compatibility services and imports', () => {
    expect(existsSync(join(root, 'src/services/claudeRunner.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/services/discordStreamer.ts'))).toBe(false);

    for (const path of productionTypeScriptFiles(join(root, 'src'))) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/claudeRunner|discordStreamer/);
    }
  });

  it('does not collapse every non-Claude provider into Codex', () => {
    const forbidden = [
      /\['claude',\s*'codex'\]\s+as const/,
      /value\s*===\s*['"]claude['"]\s*\|\|\s*value\s*===\s*['"]codex['"]/,
      /provider\s*===\s*['"]claude['"]\s*\?\s*['"]claudeModel['"]\s*:\s*['"]codexModel['"]/,
      /provider must be [`'"]claude[`'"] or [`'"]codex[`'"]/i,
      /use [`'"]\/provider claude[`'"] or [`'"]\/provider codex[`'"]/i,
    ];

    for (const path of productionTypeScriptFiles(join(root, 'src'))) {
      const source = readFileSync(path, 'utf8');
      for (const pattern of forbidden) {
        expect(source, `${path} matched ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('keeps every provider in persistent schema constraints', () => {
    const schema = readFileSync(join(root, 'src/db/schema.ts'), 'utf8');
    expect(schema).toMatch(/default_provider IN \('claude', 'codex', 'opencode'\)/);
    expect(schema).toMatch(/provider IN \('claude', 'codex', 'opencode'\)/);
    expect(schema).toMatch(/version:\s*9[\s\S]*allow OpenCode in provider-constrained tables/i);
  });

  it('registers Discord work handlers only after the durable runtime starts', () => {
    const source = readFileSync(join(root, 'src/index.ts'), 'utf8');
    const readyHandler = source.indexOf("client.once('clientReady'");
    const runtimeStart = source.indexOf('runtime = await startRuntime(client)', readyHandler);
    const readyHandlerEnd = source.indexOf('\n});', runtimeStart);
    const messageListener = source.indexOf("client.on('messageCreate', handleMessage)");
    const interactionListener = source.indexOf("client.on('interactionCreate', handleInteraction)");
    const threadListener = source.indexOf("client.on('threadDelete', handleThreadDelete)");

    expect(runtimeStart).toBeGreaterThan(readyHandler);
    expect(messageListener).toBeGreaterThan(runtimeStart);
    expect(messageListener).toBeLessThan(readyHandlerEnd);
    expect(interactionListener).toBeGreaterThan(runtimeStart);
    expect(interactionListener).toBeLessThan(readyHandlerEnd);
    expect(threadListener).toBeGreaterThan(runtimeStart);
    expect(threadListener).toBeLessThan(readyHandlerEnd);
  });

  it('uses provider-neutral package and operator documentation', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string;
      description: string;
    };
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const operatorGuide = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    const architecture = readFileSync(
      join(root, 'docs/architecture/provider-neutral-runtime.md'),
      'utf8',
    );

    expect(packageJson.name).toBe('discord-agent');
    expect(packageJson.description).toMatch(/provider-neutral/i);
    expect(readme).toMatch(/#agent/);
    expect(readme).toMatch(/old provider sessions are not automatically resumed/i);
    expect(readme).toMatch(/Claude[\s\S]*Codex[\s\S]*OpenCode[\s\S]*adapters|provider-specific adapters/i);
    expect(readme).toMatch(/persistent primary-agent chat/i);
    expect(readme).toMatch(/quiet usage admission/i);
    expect(readme).toMatch(/redact.*before.*SQLite.*Discord.*logs/is);
    expect(operatorGuide).toMatch(/TaskCoordinator/);
    expect(operatorGuide).toMatch(/ClaudeProvider/);
    expect(architecture).toMatch(/persist the provider session before awaiting completion/is);
    expect(architecture).toMatch(/redacted before persistence, Discord, and logs/is);

    const addProject = readFileSync(join(root, 'src/commands/addProject.ts'), 'utf8');
    expect(addProject).toMatch(/non-git.*cannot start.*Git/is);
    expect(addProject).not.toMatch(/not a git repository[\s\S]*Agent tasks can run/i);
  });
});
