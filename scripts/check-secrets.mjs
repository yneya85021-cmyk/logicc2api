import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const patterns = [
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['Clerk secret', /sk_(?:live|test)_[A-Za-z0-9]{24,}/g],
  ['Logicc cookie', /(?:__client=|clientCookie\s*[:=]\s*["'])[A-Za-z0-9._~+\/-]{40,}/g],
];

export function findSecrets(text) {
  return patterns.flatMap(([kind, pattern]) => [...text.matchAll(pattern)].map(match => ({ kind, line: text.slice(0, match.index).split('\n').length })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  let findings = 0;
  const report = (path, text) => {
    for (const hit of findSecrets(text)) { console.error(`${path}:${hit.line}: possible ${hit.kind} (value hidden)`); findings++; }
  };
  // An ignore rule alone does not remove a file that is already tracked.
  const ignoredTracked = git(['ls-files', '--cached', '--ignored', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  for (const path of ignoredTracked) { console.error(`${path}: ignored but still tracked; remove it from the Git index`); findings++; }
  for (const path of files) report(path, readFileSync(path, 'utf8'));
  if (process.argv.includes('--history')) {
    for (const record of git(['rev-list', '--objects', '--all']).trim().split('\n')) {
      const space = record.indexOf(' '); if (space < 0) continue;
      const oid = record.slice(0, space), path = record.slice(space + 1);
      if (git(['cat-file', '-t', oid]).trim() === 'blob') report(`${path}@${oid.slice(0, 12)}`, git(['cat-file', 'blob', oid]));
    }
  }
  if (findings) process.exitCode = 1;
  else console.log(`Credential checks passed for ${files.length} source files${process.argv.includes('--history') ? ' and reachable Git history' : ''}.`);
}
