import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const removedMarkers = [
  ['Factory', 'Floor'].join(' '),
  ['factory', 'Floor'].join(''),
  ['FACTORY', 'FLOOR'].join('_'),
  ['factory', 'floor'].join('_'),
  ['factory', 'floor'].join('-'),
  ['Discord', 'Activity'].join(' '),
  ['discord', 'activity'].join('-'),
  ['Primary', 'Entry', 'Point'].join(' '),
];

test('removed integration leaves no tracked source or documentation residuals', () => {
  const findings = [];

  for (const path of trackedFiles) {
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue;
    const content = bytes.toString('utf8');

    for (const marker of removedMarkers) {
      if (content.includes(marker)) findings.push(`${path}: ${marker}`);
    }
  }

  assert.deepEqual(findings, []);
});
