// Extracts the CHANGELOG section for the current version into a file that the
// release job publishes as the release body. Release notes must be written by a
// human in CHANGELOG.md, not generated from commit titles.
//
// Usage: node scripts/changelog-notes.cjs <output-file>
const fs = require('node:fs');

const output = process.argv[2];
if (!output) {
  console.error('usage: node changelog-notes.cjs <output-file>');
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const lines = changelog.split(/\r?\n/);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const heading = new RegExp(`^## \\[${escape(version)}\\]`);
const start = lines.findIndex((line) => heading.test(line));
if (start < 0) {
  console.error(
    `No "## [${version}]" section in CHANGELOG.md. Write the release notes before tagging.`,
  );
  process.exit(1);
}

let end = lines.length;
for (let index = start + 1; index < lines.length; index += 1) {
  if (/^## \[/.test(lines[index])) {
    end = index;
    break;
  }
}

const body = lines.slice(start, end).join('\n').trim();
fs.writeFileSync(output, `${body}\n`, 'utf8');
console.log(`Release notes for ${version}: ${body.split('\n').length} lines -> ${output}`);
