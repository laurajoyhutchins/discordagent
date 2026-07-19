import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const checkedExtensions = new Set([
  '.cjs',
  '.css',
  '.env',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const checkedNames = new Set([
  '.env.example',
  '.gitattributes',
  '.gitignore',
  'Dockerfile',
]);

// Existing debt is explicit and can only shrink. Remove an entry when its file is fixed.
const legacyMissingFinalNewline = new Set([
  'src/commands/capabilities.test.ts',
  'src/commands/register.ts',
  'src/commands/turnIntoTask.test.ts',
  'src/commands/turnIntoTask.ts',
  'src/discord/taskControlHandler.test.ts',
  'src/discord/taskControlHandler.ts',
  'src/handlers/interactionHandler.test.ts',
  'src/repositories/usageRepository.ts',
]);

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .filter(path => checkedNames.has(path) || checkedExtensions.has(extname(path)));

const failures = [];
const observedLegacyDebt = new Set();

for (const path of trackedFiles) {
  const content = readFileSync(path, 'utf8');

  if (content.includes('\0')) continue;

  if (content.includes('\r')) {
    failures.push(`${path}: use LF line endings`);
  }

  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (/[ \t]+$/.test(lines[index])) {
      failures.push(`${path}:${index + 1}: remove trailing whitespace`);
    }
  }

  if (content.length > 0 && !content.endsWith('\n')) {
    if (legacyMissingFinalNewline.has(path)) observedLegacyDebt.add(path);
    else failures.push(`${path}: add a final newline`);
  }
}

for (const path of legacyMissingFinalNewline) {
  if (!observedLegacyDebt.has(path)) {
    failures.push(`${path}: remove stale legacyMissingFinalNewline entry`);
  }
}

if (failures.length > 0) {
  console.error('Formatting hygiene violations:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Formatting hygiene passed for ${trackedFiles.length} tracked text files; ` +
      `${observedLegacyDebt.size} explicit legacy newline exceptions remain.`,
  );
}
