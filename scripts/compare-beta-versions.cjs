// Fail when a new prerelease is not newer than the manifest already serving the
// beta channel. Keeps a re-run/re-tag from pointing testers at an older build.
const fs = require('node:fs');

function parse(version) {
  const clean = String(version || '').replace(/^v/, '');
  const [core, ...pre] = clean.split('-');
  const numbers = core.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return { numbers, pre: pre.join('-') };
}

function compare(left, right) {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a.numbers[index] || 0) - (b.numbers[index] || 0);
    if (delta !== 0) return delta;
  }
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const leftParts = a.pre.split('.');
  const rightParts = b.pre.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const one = leftParts[index] ?? '';
    const two = rightParts[index] ?? '';
    if (one === two) continue;
    const oneNumber = /^\d+$/.test(one);
    const twoNumber = /^\d+$/.test(two);
    if (oneNumber && twoNumber) return Number(one) - Number(two);
    if (oneNumber) return -1;
    if (twoNumber) return 1;
    return one.localeCompare(two);
  }
  return 0;
}

const [currentFile, nextFile] = process.argv.slice(2);
if (!currentFile || !nextFile) {
  console.error('Usage: compare-beta-versions.cjs <current.json> <next.json>');
  process.exit(2);
}
const current = JSON.parse(fs.readFileSync(currentFile, 'utf8')).version;
const next = JSON.parse(fs.readFileSync(nextFile, 'utf8')).version;
const result = compare(next, current);
console.log(`beta channel: ${current} -> ${next}`);
if (result <= 0) {
  console.error(`Refusing to move the beta channel backwards (${current} -> ${next})`);
  process.exit(1);
}
