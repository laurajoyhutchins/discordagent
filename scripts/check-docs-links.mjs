import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const docsDir = join(root, 'docs');

const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
const codeFenceRegex = /```[\s\S]*?```/g;

let exitCode = 0;
const checked = new Set();

function findAllMarkdown(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('node_modules') && !entry.name.startsWith('.git') && !entry.name.startsWith('dist')) {
      files.push(...findAllMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

function resolveLink(link, sourceFile) {
  // Skip external links and anchors
  if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('#')) {
    return null;
  }

  // Strip anchor fragment for file existence check
  const filePath = link.split('#')[0];
  if (!filePath) return null;

  const base = dirname(sourceFile);
  let target = resolve(base, filePath);

  // Handle README.md linking to a directory - check for index/readme
  if (!statSync(target, { throwIfNoEntry: false })) {
    // Maybe it's a directory with an index or readme
    const asDir = target;
    if (statSync(asDir, { throwIfNoEntry: false })?.isDirectory()) {
      // Check for README.md in that directory
      if (statSync(join(asDir, 'README.md'), { throwIfNoEntry: false })) {
        return null; // valid
      }
    }
    return `File not found: ${target} (from ${sourceFile})`;
  }

  return null; // valid
}

const files = findAllMarkdown(docsDir);
// Also check root README.md
files.push(join(root, 'README.md'));

for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  // Remove code blocks to avoid checking links in code
  const textWithoutCode = content.replace(codeFenceRegex, '');

  let match;
  while ((match = linkRegex.exec(textWithoutCode)) !== null) {
    const link = match[2].trim();

    // Skip data: URIs, mailto, etc.
    if (link.startsWith('data:') || link.startsWith('mailto:') || link.startsWith('tel:')) continue;
    // Skip external URLs
    if (link.startsWith('http://') || link.startsWith('https://')) continue;
    // Skip fragment-only links
    if (link.startsWith('#')) continue;

    const relPath = relative(root, file);
    if (!checked.has(`${relPath}:${link}`)) {
      checked.add(`${relPath}:${link}`);
      const error = resolveLink(link, file);
      if (error) {
        console.error(`BROKEN LINK: ${relPath}: ${link}`);
        console.error(`  ${error}`);
        exitCode = 1;
      }
    }
  }
}

if (exitCode === 0) {
  console.log(`All ${checked.size} internal links resolve.`);
}
process.exit(exitCode);
