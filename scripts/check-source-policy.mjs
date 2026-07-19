import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sourceFiles = execFileSync('git', ['ls-files', '-z', '--', 'src/**/*.ts', 'scripts/**/*.mjs'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

const policies = [
  {
    pattern: /\b(?:describe|it|test)\.only\s*\(/g,
    message: 'focused tests must not be committed',
  },
  {
    pattern: /^(?:<<<<<<<|=======|>>>>>>>)(?: .*)?$/gm,
    message: 'unresolved merge-conflict marker',
  },
];

const failures = [];

for (const path of sourceFiles) {
  const content = readFileSync(path, 'utf8');

  for (const policy of policies) {
    for (const match of content.matchAll(policy.pattern)) {
      const line = content.slice(0, match.index).split('\n').length;
      failures.push(`${path}:${line}: ${policy.message}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Source policy violations:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Source policy passed for ${sourceFiles.length} TypeScript and tooling files.`);
}
