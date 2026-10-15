import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createTestHarness } from 'wrangler';

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
process.env.WRANGLER_SEND_METRICS = 'false';

// Generated test credentials never leave the local mock / local Workers runtime.
const jwt = (exp = Date.now() / 1000 + 3600) => `${Buffer.from('{"alg":"test"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sid: 'sess_worker_test', exp })).toString('base64url')}.test`;

test('Worker auth, real workerd routing, protocols, storage, and isolation', { timeout: 90000 }, async t => {
  const hits = [], adminPassword = randomBytes(24).toString('hex'), apiKey = randomBytes(24).toString('hex');
  const mock = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    hits.push({ path: req.url, body, cookie: req.headers.cookie, hasAuthorization: Boolean(req.headers.authorization) });
    const json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    if (req.url.includes('/tokens')) {
      res.setHeader('Set-Cookie', '__client=rotated_worker_test_cookie; HttpOnly; Path=/');
      return json({ jwt: jwt() });
    }
    if (req.url.startsWith('/api/models')) return json([{ id: 'test-model', name: 'Test', provider: 'test', isDefault: true }]);
    if (req.url === '/api/assistants/test-assistant') return json({ id: 'test-assistant', name: 'Test assistant', modelId: 'test-model', permissions: 'owner', systemPrompt: 'A test prompt.', isDraft: false });
    if (req.url.startsWith('/api/assistants/long-')) return json({ id: req.url.split('/').at(-1), name: 'Large prompt', modelId: 'test-model', permissions: 'owner', systemPrompt: '🌍'.repeat(12000), isDraft: false });
    if (req.url === '/api/chats') return json('test-chat');
    if (req.url === '/api/chats/test-chat') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const answer = body.prompt.includes('worker_test_tool') && !body.prompt.includes('"role":"tool"') ? JSON.stringify({ tool_calls: [{ name: 'worker_test_tool', arguments: { value: 1 } }] }) : 'hello from mock';
      for (const event of [{ type: 'text-delta', delta: answer }, { type: 'finish', usage: { inputTokens: 1, outputTokens: 3 } }]) res.write(`data: ${JSON.stringify(event)}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    res.statusCode = 404; json({ error: 'unknown mock route' });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  t.after(() => { mock.closeAllConnections(); mock.close(); });
  const upstream = `http://127.0.0.1:${mock.address().port}`;
  const options = { workers: [{ configPath: './wrangler.jsonc', secrets: { LOGICC_ADMIN_PASSWORD: adminPassword, LOGICC_API_KEY: apiKey }, vars: { LOGICC_API_BASE: upstream + '/api', LOGICC_CLERK_BASE: upstream } }] };
  const harness = createTestHarness(options);
  t.after(async () => { if (!t.passed) harness.debug(); await harness.close(); });
  const { url } = await harness.listen();
  const origin = url.origin;
  const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${adminPassword}`).toString('base64'), 'X-Logicc-Admin': '1' };
  const apiAuth = { Authorization: `Bearer ${apiKey}` };
  const responses = [];
  const request = async (path, method = 'GET', body, headers = auth) => {
    const response = await harness.fetch(`${origin}${path}`, {
      method, redirect: 'manual', headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    responses.push(response);
    return response;
  };
  const check = async (name, run) => { await run(); t.diagnostic(name); };
  const jsonRequest = async (...args) => { const response = await request(...args); return { status: response.status, data: await response.json() }; };

  await check('anonymous and wrong-role requests cannot reach private data', async () => {
    for (const path of ['/', '/app.js', '/api/state']) assert.equal((await request(path, 'GET', undefined, {})).status, 401);
    assert.equal((await request('/api/state', 'GET', undefined, apiAuth)).status, 401);
    assert.equal((await request('/v1/models', 'GET', undefined, {})).status, 401);
    assert.equal((await request('/api/state', 'GET', undefined, { ...auth, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/api/state', 'GET', undefined, { ...auth, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await request('/__set_token', 'POST', {})).status, 404);
    assert.equal((await request('/health', 'GET', undefined, {})).status, 200);
    // Ignore only credential-free root probes observed during local runtime startup.
    const upstreamHits = hits.filter(h => h.path !== '/' || h.cookie || h.hasAuthorization);
    assert.equal(upstreamHits.length, 0, JSON.stringify(upstreamHits.map(h => h.path)));
  });
  await check('authenticated console assets and public Base URL work', async () => {
    const page = await request('/'); assert.equal(page.status, 200); assert.match(await page.text(), /<html/);
    assert.equal(page.headers.get('Cache-Control'), 'no-store');
    const state = await jsonRequest('/api/state', 'GET', undefined, { ...auth, Origin: origin });
    assert.equal(state.status, 200); assert.equal(state.data.service.baseUrl, `${origin}/v1`);
    assert.deepEqual(state.data.accounts, []);
  });
  const added = await jsonRequest('/api/accounts', 'POST', { name: 'Worker test account', token: jwt(1), clientCookie: 'worker_test_cookie' });
  assert.equal(added.status, 201); const id = added.data.account.id;
  await check('refresh, cookie rotation, and model discovery work through Node compatibility', async () => {
    const models = await jsonRequest('/v1/models', 'GET', undefined, apiAuth);
    assert.equal(models.status, 200, JSON.stringify(models.data)); assert.equal(models.data.data[0].id, 'test-model');
    assert.equal(hits.find(h => h.path.includes('/tokens')).cookie, '__client=worker_test_cookie');
    const state = await jsonRequest('/api/state');
    assert.equal(state.data.accounts[0].hasToken, true);
    assert.ok(!JSON.stringify(state).includes('rotated_worker_test_cookie'));
  });
  await check('all three generation protocols return JSON and SSE', async () => {
    for (const [path, body, terminal] of [
      ['/v1/chat/completions', { messages: [{ role: 'user', content: 'hello' }] }, '[DONE]'],
      ['/v1/responses', { input: 'hello' }, 'response.completed'],
      ['/v1/messages', { messages: [{ role: 'user', content: 'hello' }], max_tokens: 128 }, 'message_stop'],
    ]) {
      for (const stream of [false, true]) {
        const response = await request(path, 'POST', { model: 'test-model', ...body, stream }, apiAuth);
        assert.equal(response.status, 200); const text = await response.text();
        assert.ok(text.includes('hello from mock')); if (stream) assert.ok(text.includes(terminal)); else JSON.parse(text);
      }
    }
    const tools = await jsonRequest('/v1/chat/completions', 'POST', { model: 'test-model', messages: [{ role: 'user', content: 'call worker_test_tool' }], tools: [{ type: 'function', function: { name: 'worker_test_tool', parameters: { type: 'object', properties: { value: { type: 'integer' } } } } }] }, apiAuth);
    assert.equal(tools.status, 200); assert.equal(tools.data.choices[0].message.tool_calls[0].function.name, 'worker_test_tool');
    const counted = await jsonRequest('/v1/messages/count_tokens', 'POST', { model: 'test-model', messages: [{ role: 'user', content: 'hello' }] }, { 'x-api-key': apiKey });
    assert.equal(counted.status, 200);
  });
  await check('Messages accepts mixed roles and Chat-style tool history in Workers', async () => {
    const body = { model: 'test-model', system: 'TOP_SYSTEM', messages: [
      { role: 'system', content: 'INLINE_SYSTEM' }, { role: 'developer', content: 'DEVELOPER_RULE' }, { role: 'user', content: 'hello' },
    ], tools: [{ type: 'function', function: { name: 'worker_test_tool', parameters: { type: 'object', properties: { value: { type: 'integer' } } } } }], tool_choice: { type: 'function', function: { name: 'worker_test_tool' } } };
    const first = await jsonRequest('/v1/messages', 'POST', body, apiAuth);
    assert.equal(first.status, 200); assert.equal(first.data.stop_reason, 'tool_use');
    const call = first.data.content[0];
    assert.equal(call.type, 'tool_use'); assert.equal(call.name, 'worker_test_tool');
    assert.ok(hits.at(-1).body.prompt.includes('DEVELOPER_RULE'));
    const next = { ...body, tool_choice: 'auto', messages: [...body.messages,
      { role: 'assistant', content: null, tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) } }] },
      { role: 'tool', tool_call_id: call.id, content: '1' },
    ] };
    for (const stream of [false, true]) {
      const response = await request('/v1/messages', 'POST', { ...next, stream }, apiAuth);
      assert.equal(response.status, 200);
      const text = await response.text(); assert.ok(text.includes('hello from mock'));
      if (stream) assert.ok(text.includes('message_stop')); else assert.equal(JSON.parse(text).stop_reason, 'end_turn');
    }
    assert.equal((await jsonRequest('/v1/messages/count_tokens', 'POST', next, { 'x-api-key': apiKey })).status, 200);
  });
  await check('account and assistant data are written to durable storage', async () => {
    assert.equal((await jsonRequest(`/api/accounts/${id}/assistants/test-assistant`)).status, 200);
    assert.equal((await jsonRequest(`/api/accounts/${id}/default-assistant`, 'PUT', { assistantId: 'test-assistant' })).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await jsonRequest(`/api/accounts/${id}/assistants/long-${i}`)).status, 200);
    const storage = await harness.getWorker().getDurableObjectStorage('LOGICC', { name: 'account-pool' });
    const accounts = await storage.exec("SELECT value FROM documents WHERE name = 'accounts' ORDER BY part");
    const stored = JSON.parse(accounts.map(row => row.value).join(''));
    assert.equal(stored.accounts[0].clientCookie, 'rotated_worker_test_cookie');
    assert.ok(stored.requests.length >= 7);
    const prompts = await storage.exec("SELECT value FROM documents WHERE name = 'assistant-prompts' ORDER BY part");
    assert.ok(prompts.length > 1);
    const savedPrompts = JSON.parse(prompts.map(row => row.value).join(''));
    for (const snapshot of savedPrompts.snapshots.filter(s => s.id.startsWith('long-'))) assert.equal(snapshot.originalSystemPrompt, '🌍'.repeat(12000));
    for (const response of responses) if (!response.bodyUsed) await response.arrayBuffer();
    await harness.getWorker().evictDurableObject('LOGICC', { name: 'account-pool' });
    const afterEviction = await jsonRequest('/api/state');
    assert.equal(afterEviction.data.accounts[0].id, id);
    assert.equal(afterEviction.data.assistantDefaults[id].id, 'test-assistant');
    const newApiKey = randomBytes(24).toString('hex');
    await harness.update({ workers: [{ ...options.workers[0], secrets: { LOGICC_ADMIN_PASSWORD: adminPassword, LOGICC_API_KEY: newApiKey } }] });
    const state = await jsonRequest('/api/state');
    assert.equal(state.data.accounts[0].id, id);
    assert.equal(state.data.assistantDefaults[id].id, 'test-assistant');
    const prompt = await jsonRequest(`/api/accounts/${id}/assistants/test-assistant`);
    assert.equal(prompt.data.assistant.originalSystemPrompt, 'A test prompt.');
    assert.equal((await request('/v1/models', 'GET', undefined, apiAuth)).status, 401);
    assert.equal((await request('/v1/models', 'GET', undefined, { Authorization: `Bearer ${newApiKey}` })).status, 200);
  });
  await check('missing deployment secrets fail closed', async () => {
    await harness.update({ workers: [{ ...options.workers[0], secrets: { LOGICC_ADMIN_PASSWORD: '', LOGICC_API_KEY: '' } }] });
    assert.equal((await request('/api/state')).status, 503);
    assert.equal((await request('/v1/models', 'GET', undefined, apiAuth)).status, 503);
  });
});
