import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { findSecrets } from '../scripts/check-secrets.mjs';

test('credential guard reports locations without revealing values; local credentials are ignored', () => {
  const token = [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from('{"sid":"test-session","exp":1}').toString('base64url'), 'synthetic-signature'].join('.');
  assert.deepEqual(findSecrets('example\n' + token), [{ kind: 'JWT', line: 2 }]);
  assert.ok(!JSON.stringify(findSecrets(token)).includes(token));
  assert.deepEqual(findSecrets('LOGICC_API_KEY=""\nSession JWT: YOUR_SESSION_JWT'), []);
  const files = ['data/state.json', '.env', '.env.production', '.dev.vars', '.dev.vars.production', '.wrangler/state/db.sqlite', 'accounts.json', 'credentials.json', 'logicc-token.txt', 'logicc-cookies.txt', 'capture.har', 'capture.pcap', 'tls.keys', 'compose.override.yaml'];
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], { input: files.join('\n') + '\n', encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(ignored, files);
});
