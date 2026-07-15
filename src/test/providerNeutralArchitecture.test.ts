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

describe('provider-neutral Phase 1 architecture', () => {
  it('removes obsolete Claude compatibility services and imports', () => {
    expect(existsSync(join(root, 'src/services/claudeRunner.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/services/discordStreamer.ts'))).toBe(false);

    for (const path of productionTypeScriptFiles(join(root, 'src'))) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/claudeRunner|discordStreamer/);
    }
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
    expect(readme).toMatch(/Codex.*not yet executable/is);
    expect(readme).toMatch(/redact.*before.*SQLite.*Discord.*logs/is);
    expect(operatorGuide).toMatch(/TaskCoordinator/);
    expect(operatorGuide).toMatch(/ClaudeProvider/);
    expect(architecture).toMatch(/persist.*provider session.*before.*await/is);
    expect(architecture).toMatch(/redact.*before.*persistence.*rendering.*logging/is);

    const addProject = readFileSync(join(root, 'src/commands/addProject.ts'), 'utf8');
    expect(addProject).toMatch(/non-git.*cannot start.*Git/is);
    expect(addProject).not.toMatch(/not a git repository[\s\S]*Agent tasks can run/i);
  });
});
