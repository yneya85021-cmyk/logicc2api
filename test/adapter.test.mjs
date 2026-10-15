import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountPool, claims, upstreamFetch } from '../pool.mjs';
import { createAdapter, parseAiSdkStream } from '../server.mjs';

const jwt = (sid, suffix='initial', exp=Math.floor(Date.now()/1000)+120) => `${Buffer.from('{"alg":"test"}').toString('base64url')}.${Buffer.from(JSON.stringify({sid,exp})).toString('base64url')}.${suffix}`;
const listen = async server => {server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;};
const close = server => new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});

test('upstream network failures explain DNS/connection errors without exposing credentials', async t => {
  let failure;
  t.mock.method(globalThis, 'fetch', async () => { throw failure; });
  for (const code of ['EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT', 'CERT_HAS_EXPIRED']) {
    failure = new TypeError('fetch failed', { cause: Object.assign(new Error('sensitive-cookie-value'), { code }) });
    await assert.rejects(upstreamFetch('https://clerk.logicc.com/private-session?token=sensitive-cookie-value', {}), error => {
      assert.equal(error.status, 502); assert.ok(error.message.includes('clerk.logicc.com'));
      assert.ok(error.message.includes(code)); assert.ok(!error.message.includes('sensitive-cookie-value'));
      assert.ok(!error.message.includes('private-session')); return true;
    });
  }
  failure = new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('hidden'), { code: 'ETIMEDOUT' })]) });
  await assert.rejects(upstreamFetch('https://app.logicc.com/api/models', {}), /ETIMEDOUT/);
  failure = new Error('sensitive-cookie-value');
  await assert.rejects(upstreamFetch('https://app.logicc.com/api/models', {}), /上游网络连接失败/);
  const signal = AbortSignal.abort();
  await assert.rejects(upstreamFetch('https://app.logicc.com/api/models', { signal }), error => error === failure);
});

async function harness(t,extra={},reply,assistants) {
  const folder=mkdtempSync(join(tmpdir(),'logicc-test-'));
  const hits=[], tokenCalls=[];
  const mock=createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const sid=claims((req.headers.authorization||'').slice(7)).sid;
    const body=text?JSON.parse(text):{};
    hits.push({url:req.url,body,sid});
    const respond=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(assistants && req.url.startsWith('/api/assistants')){
      const path=req.url.slice('/api/assistants'.length);
      if(path==='/list'){
        if(!body.sortType || !body.sortDirection)return respond(400,{});
        return respond(200,{data:[...assistants.values()].filter(a=>!a.isDraft),hasMore:false});
      }
      if(path==='' && req.method==='POST'){
        const id='draft-'+hits.length, parent=body.parentId?assistants.get(body.parentId):null;
        if(body.parentId&&!parent)return respond(404,{});
        assistants.set(id,{...(parent||{name:'',modelId:'test-fast',systemPrompt:'',permissions:'owner',visibility:'private'}),id,isDraft:true,draftId:null,parentId:body.parentId});
        if(parent)parent.draftId=id;
        return respond(200,id);
      }
      const parts=path.slice(1).split('/'),current=assistants.get(parts[0]);
      if(!current)return respond(404,{});
      if(req.method==='GET')return respond(200,current);
      if(req.method==='PATCH'){if(!current.isDraft)return respond(409,{});Object.assign(current,body);res.writeHead(204);res.end();return;}
      if(parts[1]==='save' && req.method==='POST'){
        const target=current.parentId||current.id;
        assistants.set(target,{...current,id:target,isDraft:false,draftId:null,parentId:null});
        if(target!==current.id)assistants.delete(current.id);
        return respond(200,target);
      }
      return respond(405,{});
    }
    if(req.url.includes('/tokens')){
      tokenCalls.push(req.headers.cookie);
      const session=req.url.split('/')[4];
      if(session==='sess_bad')return respond(401,{error:'invalid'});
      res.setHeader('Set-Cookie','__client=rotated_cookie; HttpOnly; Path=/');
      return respond(200,{jwt:jwt(session,'refreshed')});
    }
    if(req.url.startsWith('/api/models')){
      if(sid==='sess_redirect'){res.writeHead(302,{Location:'/redirect-target'});res.end();return;}
      if(sid==='sess_old' && !req.headers.authorization.endsWith('refreshed'))return respond(401,{error:'revoked'});
      if(sid==='sess_limited')return respond(429,{error:'limited'});
      return respond(200,[{id:'test-fast',name:'Test Fast',provider:'test',isDefault:true},{id:'test-slow',provider:'test'}]);
    }
    if(req.url==='/api/chats')return respond(200,'a-mock-chat-id');
    if(req.url.startsWith('/api/chats/')){
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      if(reply){for(const event of await reply(body)){res.write(`data: ${JSON.stringify(event)}\n\n`);}res.end();return;}
      if(body.prompt==='ERROR'){res.end('data: {"type":"error","errorText":"mock failure"}\n\n');return;}
      res.write('data: {"type":"text-delta","delta":"你好"}\r\n\r\n');
      if(body.prompt==='TRUNCATED'){res.end();return;}
      if(body.forcedTool)res.write(`data: ${JSON.stringify({type:'tool-input-start',toolName:body.forcedTool})}\n\n`);
      res.end('data: {"type":"text-delta","delta":"，测试通过。"}\r\n\r\ndata: {"type":"finish","usage":{"inputTokens":5,"outputTokens":8}}\r\n\r\ndata: [DONE]\r\n\r\n');
      return;
    }
    respond(404,{});
  });
  const upstream=await listen(mock);
  const file=join(folder,'state.json');
  const {server,pool}=createAdapter({dataFile:file,env:{LOGICC_API_BASE:`${upstream}/api`,LOGICC_CLERK_BASE:upstream,...extra}});
  const base=await listen(server);
  t.after(async()=>{await close(server);await close(mock);rmSync(folder,{recursive:true,force:true});});
  const api=async(path,method='GET',body,headers={})=>{
    const response=await fetch(base+path,{method,headers:{'X-Logicc-Admin':'1',...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  const add=async(name,sid,extra={})=>(await api('/api/accounts','POST',{name,token:jwt(sid),...extra})).data.account;
  return {base,api,pool,file,hits,tokenCalls,add};
}

test('account CRUD, atomic import, credential masking, persistence, validation',async t=>{
  const {api,add,file}=await harness(t);
  const a=await add('工作账户','sess_one',{clientCookie:'secret_cookie'});
  assert.ok(a.id);assert.equal(a.hasClientCookie,true);assert.equal(a.token,undefined);
  assert.equal((await api(`/api/accounts/${a.id}`,'PATCH',{name:'新名称',clientCookie:'',enabled:false})).data.account.enabled,false);
  assert.equal(JSON.parse(readFileSync(file)).accounts[0].clientCookie,'secret_cookie');
  await api(`/api/accounts/${a.id}`,'PATCH',{clientCookie:'replacement_cookie',sessionId:'sess_replaced'});
  assert.equal(JSON.parse(readFileSync(file)).accounts[0].token,'');
  assert.equal(statSync(file).mode & 0o777,0o600);
  const imported=await api('/api/accounts/import','POST',[{name:'第二个',token:jwt('sess_two')},{name:'重复项',token:jwt('sess_replaced')}]);
  assert.equal(imported.status,409);assert.equal((await api('/api/state')).data.accounts.length,1);
  assert.equal((await api('/api/accounts/import','POST',[{name:'第二个',token:jwt('sess_two')}])).status,201);
  const state=(await api('/api/state')).data;
  assert.equal(state.accounts.length,2);assert.ok(!JSON.stringify(state).includes('secret_cookie'));assert.ok(!JSON.stringify(state).includes(jwt('sess_one')));
  assert.equal((await api('/api/accounts','POST',{name:'Bad',token:'a.b.c'})).status,400);
  assert.equal((await api('/api/accounts','POST',{name:'Bad',token:`a.${Buffer.from('null').toString('base64url')}.c`})).status,400);
  assert.equal((await api('/api/accounts','POST',{name:'Bad',clientCookie:'x',sessionId:'../etc'})).status,400);
  assert.equal((await api(`/api/accounts/${a.id}`,'DELETE')).status,200);
  const reloaded=new AccountPool(file,{});assert.equal(reloaded.data.accounts.length,1);
});

test('upstream redirects are rejected without forwarding account credentials', async t => {
  const { api, add, hits } = await harness(t);
  await add('Redirect test', 'sess_redirect');
  const result = await api('/v1/models');
  assert.equal(result.status, 502);
  assert.equal(hits.some(hit => hit.url === '/redirect-target'), false);
});

test('round-robin uses enabled accounts and 429 cools only the affected account',async t=>{
  const {api,add,hits}=await harness(t);
  await add('第一','sess_first');const second=await add('第二','sess_second');
  await api('/v1/models');await api('/v1/models');await api('/v1/models');
  assert.deepEqual(hits.filter(h=>h.url.startsWith('/api/models')).map(h=>h.sid),['sess_first','sess_second','sess_first']);
  await api(`/api/accounts/${second.id}`,'PATCH',{enabled:false});
  await api('/v1/models');assert.equal(hits.at(-1).sid,'sess_first');
  const limited=await add('限流','sess_limited');
  assert.equal((await api(`/api/accounts/${limited.id}/check`,'POST',{})).status,429);
  assert.equal((await api('/api/state')).data.accounts.find(a=>a.id===limited.id).status,'cooling');
  for(let i=0;i<3;i++)assert.equal((await api('/v1/models')).status,200);
  assert.equal(hits.at(-1).sid,'sess_first');
});

test('401 forces a different JWT, persists rotated cookie and joins concurrent refreshes',async t=>{
  const {api,add,pool,file,tokenCalls}=await harness(t);
  const a=await add('过期认证','sess_old',{clientCookie:'original_cookie'});
  assert.equal((await api('/v1/models')).status,200);
  assert.equal(tokenCalls.length,1);
  const persisted=JSON.parse(readFileSync(file)).accounts[0];
  assert.equal(persisted.clientCookie,'rotated_cookie');assert.ok(persisted.token.endsWith('refreshed'));
  const account=pool.account(a.id);account.token=jwt('sess_old','expired',1);
  await Promise.all([pool.tokenFor(account),pool.tokenFor(account),pool.tokenFor(account)]);
  assert.equal(tokenCalls.length,2);
  assert.equal(tokenCalls.at(-1),'__client=rotated_cookie');
});

test('OpenAI JSON + SSE, UTF-8/CRLF, tools, usage and actual request statistics',async t=>{
  const {api,add,base,hits}=await harness(t);await add('测试','sess_chat');
  const completion=await api('/v1/chat/completions','POST',{messages:[{role:'user',content:'你好'}]});
  assert.equal(completion.status,200);assert.equal(completion.data.choices[0].message.content,'你好，测试通过。');
  assert.equal(completion.data.usage.total_tokens,13);
  const response=await fetch(`${base}/v1/chat/completions`,{method:'POST',body:JSON.stringify({model:'test-fast',stream:true,stream_options:{include_usage:true},messages:[{role:'user',content:'工具测试'}],tools:[{type:'web_search'}]})});
  assert.equal(response.status,200);const text=await response.text();assert.ok(text.endsWith('data: [DONE]\n\n'));
  const frames=text.split('\n\n').filter(f=>f.startsWith('data: {')).map(f=>JSON.parse(f.slice(6)));
  assert.equal(frames[0].choices[0].delta.role,'assistant');assert.ok(frames.some(f=>f.choices[0]?.delta.content?.includes('[tool:web-search]')));
  assert.equal(frames.at(-1).usage.total_tokens,13);assert.equal(hits.at(-1).body.forcedTool,'web-search');
  const state=(await api('/api/state')).data;assert.equal(state.stats.requests,2);assert.equal(state.stats.successRate,100);assert.equal(state.modelStats[0].requests,2);assert.ok(state.stats.avgTtft>=0);
});

test('upstream stream errors and truncation are failures, including after response headers',async t=>{
  const {api,add,base,pool}=await harness(t);const account=await add('错误测试','sess_error');
  const bad=await api('/v1/chat/completions','POST',{model:'test-fast',messages:[{role:'user',content:'ERROR'}]});
  assert.equal(bad.status,502);assert.match(bad.data.error.message,/mock failure/);
  pool.runtimeFor(account.id).cooldownUntil=0;
  const response=await fetch(`${base}/v1/chat/completions`,{method:'POST',body:JSON.stringify({model:'test-fast',stream:true,messages:[{role:'user',content:'TRUNCATED'}]})});
  const text=await response.text();assert.ok(text.includes('"error"'));assert.ok(text.includes('[DONE]'));
  const state=(await api('/api/state')).data;assert.equal(state.stats.requests,2);assert.equal(state.stats.failures,2);assert.equal(state.stats.successRate,0);
});

test('local-origin boundary, API key, malformed JSON, oversized body, and empty pool',async t=>{
  const {api,base}=await harness(t,{LOGICC_API_KEY:'only-test-key'});
  assert.equal((await api('/v1/models')).status,401);
  assert.equal((await api('/v1/models','GET',undefined,{Authorization:'Bearer only-test-key'})).status,503);
  assert.equal((await fetch(base+'/api/state')).status,403);
  assert.equal((await api('/api/state','GET',undefined,{Origin:'https://evil.example'})).status,403);
  assert.equal((await api('/api/state','GET',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await fetch(base+'/api/accounts',{method:'POST',headers:{'X-Logicc-Admin':'1','Content-Type':'application/json'},body:'{'})).status,400);
  assert.equal((await fetch(base+'/api/accounts',{method:'POST',headers:{'X-Logicc-Admin':'1','Content-Type':'application/json'},body:'x'.repeat(1048577)})).status,413);
  assert.equal((await api('/api/accounts','POST',null)).status,400);
  assert.equal((await fetch(base+'/__set_token',{method:'POST',headers:{Origin:'https://evil.example'},body:jwt('sess_test')})).status,403);
  const bridge=await fetch(base+'/__set_token',{method:'POST',headers:{Origin:'https://app.logicc.com'},body:jwt('sess_bridge')});
  assert.equal(bridge.status,200);assert.equal(bridge.headers.get('Access-Control-Allow-Origin'),'https://app.logicc.com');
});

test('SSE parser supports split multibyte text and unterminated final frames',async()=>{
  const buffer=Buffer.from('data: {"type":"text-delta","delta":"中文"}\r\n\r\ndata: {"type":"finish"}');
  async function* bytes(){for(const byte of buffer)yield new Uint8Array([byte]);}
  const events=[];for await(const event of parseAiSdkStream(bytes()))events.push(event);
  assert.deepEqual(events,[{type:'text-delta',delta:'中文'},{type:'finish'}]);
});

const weatherSchema={type:'object',properties:{city:{type:'string'}},required:['city'],additionalProperties:false};
const chatTools=[{type:'function',function:{name:'get_weather',description:'Get current weather',parameters:weatherSchema}}];
const responseTools=[{type:'function',name:'get_weather',description:'Get current weather',parameters:weatherSchema}];
const messageTools=[{name:'get_weather',description:'Get current weather',input_schema:weatherSchema}];
const textEvents=(text,reason='stop')=>[{type:'text-delta',delta:text.slice(0,12)},{type:'text-delta',delta:text.slice(12)},{type:'finish',finishReason:reason,usage:{inputTokens:5,outputTokens:8}}];
const toolReply=body=>textEvents('```json\n'+JSON.stringify(body.prompt.includes('"role":"tool"')||body.prompt.includes('[Tool result:') ? {content:'Hangzhou: 21 C',tool_calls:[]} : {content:null,tool_calls:[{name:'get_weather',arguments:{city:'Hangzhou'}}]})+'\n```');
function sseFrames(text) {
  return text.split(/\r?\n\r?\n/).filter(frame=>frame.includes('data: {')).map(frame=>{
    const lines=frame.split(/\r?\n/);return {event:lines.find(l=>l.startsWith('event:'))?.slice(7),data:JSON.parse(lines.find(l=>l.startsWith('data:')).slice(6))};
  });
}

test('Chat Completions emits real tool_calls and preserves call IDs through a tool-result round trip',async t=>{
  const {api,add,hits}=await harness(t,{},toolReply);await add('tools','sess_tools');
  const request={model:'test-fast',messages:[{role:'user',content:'Get Hangzhou weather'}],tools:chatTools,tool_choice:'required'};
  const first=await api('/v1/chat/completions','POST',request);
  assert.equal(first.status,200);const message=first.data.choices[0].message;
  assert.equal(first.data.choices[0].finish_reason,'tool_calls');assert.equal(message.content,null);
  assert.equal(message.tool_calls[0].function.name,'get_weather');assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments),{city:'Hangzhou'});
  const result=await api('/v1/chat/completions','POST',{...request,tool_choice:'auto',messages:[...request.messages,message,{role:'tool',tool_call_id:message.tool_calls[0].id,content:'21 C'}]});
  assert.equal(result.status,200);assert.equal(result.data.choices[0].message.content,'Hangzhou: 21 C');assert.equal(result.data.choices[0].finish_reason,'stop');
  assert.ok(hits.at(-1).body.prompt.includes(message.tool_calls[0].id));assert.ok(hits.at(-1).body.prompt.includes('21 C'));
});

test('Chat streaming uses indexed tool-call deltas instead of exposing raw JSON as text',async t=>{
  const {base,add}=await harness(t,{},toolReply);await add('stream tools','sess_toolstream');
  const response=await fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'test-fast',stream:true,messages:[{role:'user',content:'Weather'}],tools:chatTools,tool_choice:{type:'function',function:{name:'get_weather'}}})});
  const text=await response.text(),frames=sseFrames(text).map(f=>f.data);
  assert.ok(text.endsWith('data: [DONE]\n\n'));assert.ok(frames.every(f=>!f.choices[0]?.delta?.content));
  const deltas=frames.flatMap(f=>f.choices[0]?.delta?.tool_calls||[]);
  assert.equal(deltas[0].index,0);assert.ok(deltas[0].id);assert.equal(deltas[0].function.name,'get_weather');
  assert.deepEqual(JSON.parse(deltas.map(d=>d.function.arguments||'').join('')),{city:'Hangzhou'});
  assert.equal(frames.at(-1).choices[0].finish_reason,'tool_calls');
});

test('Responses supports input text, function_call_output, stored continuation, retrieval and deletion',async t=>{
  const {api,add,hits}=await harness(t,{},toolReply);await add('responses','sess_responses');
  const first=await api('/v1/responses','POST',{model:'test-fast',instructions:'ONLY_FIRST_INSTRUCTIONS',input:'Weather in Hangzhou',tools:responseTools,tool_choice:'required'});
  assert.equal(first.status,200);assert.equal(first.data.object,'response');assert.equal(first.data.status,'completed');
  const call=first.data.output[0];assert.equal(call.type,'function_call');assert.equal(call.name,'get_weather');assert.ok(call.call_id);
  assert.deepEqual(JSON.parse(call.arguments),{city:'Hangzhou'});assert.equal(first.data.usage.total_tokens,13);
  assert.equal((await api(`/v1/responses/${first.data.id}`)).data.id,first.data.id);
  const second=await api('/v1/responses','POST',{model:'test-fast',previous_response_id:first.data.id,input:[{type:'function_call_output',call_id:call.call_id,output:'21 C'}],tools:responseTools});
  assert.equal(second.status,200);assert.equal(second.data.output[0].content[0].text,'Hangzhou: 21 C');
  assert.ok(hits.at(-1).body.prompt.includes(call.call_id));assert.ok(!hits.at(-1).body.prompt.includes('ONLY_FIRST_INSTRUCTIONS'));
  assert.equal((await api(`/v1/responses/${first.data.id}`,'DELETE')).data.deleted,true);
  assert.equal((await api(`/v1/responses/${first.data.id}`)).status,404);
  const unStored=await api('/v1/responses','POST',{input:'Weather',tools:responseTools,store:false});
  assert.equal((await api(`/v1/responses/${unStored.data.id}`)).status,404);
});

test('Responses SSE emits matching item IDs, argument deltas and a complete final response',async t=>{
  const {base,add}=await harness(t,{},toolReply);await add('response stream','sess_respstream');
  const response=await fetch(base+'/v1/responses',{method:'POST',body:JSON.stringify({model:'test-fast',input:[{role:'user',content:[{type:'input_text',text:'Weather'}]}],tools:responseTools,stream:true})});
  const text=await response.text(),frames=sseFrames(text);
  assert.equal(frames[0].event,'response.created');assert.equal(frames[1].event,'response.in_progress');
  const added=frames.find(f=>f.event==='response.output_item.added').data;
  const delta=frames.find(f=>f.event==='response.function_call_arguments.delta').data;
  const done=frames.find(f=>f.event==='response.output_item.done').data;
  assert.equal(delta.item_id,added.item.id);assert.equal(delta.output_index,added.output_index);assert.equal(done.item.call_id,added.item.call_id);
  assert.deepEqual(JSON.parse(delta.delta),{city:'Hangzhou'});
  assert.equal(frames.at(-1).event,'response.completed');assert.deepEqual(frames.at(-1).data.response.output[0],done.item);
  assert.deepEqual(frames.map(f=>f.data.sequence_number),frames.map((_,i)=>i));assert.ok(!text.includes('[DONE]'));
});

test('Messages supports system text, tool_use, tool_result and x-api-key authentication',async t=>{
  const {api,add,hits}=await harness(t,{LOGICC_API_KEY:'messages-key'},toolReply);await add('messages','sess_messages');
  const headers={'x-api-key':'messages-key','anthropic-version':'2023-06-01'};
  const body={model:'test-fast',system:[{type:'text',text:'SYSTEM_SENTINEL'}],max_tokens:512,messages:[{role:'user',content:'Weather in Hangzhou'}],tools:messageTools,tool_choice:{type:'any'}};
  assert.equal((await api('/v1/messages','POST',body)).data.error.type,'authentication_error');
  const first=await api('/v1/messages','POST',body,headers);
  assert.equal(first.status,200);assert.equal(first.data.type,'message');assert.equal(first.data.stop_reason,'tool_use');
  const call=first.data.content[0];assert.equal(call.type,'tool_use');assert.equal(call.name,'get_weather');assert.deepEqual(call.input,{city:'Hangzhou'});
  assert.ok(hits.at(-1).body.prompt.includes('SYSTEM_SENTINEL'));
  const second=await api('/v1/messages','POST',{...body,tool_choice:{type:'auto'},messages:[...body.messages,{role:'assistant',content:first.data.content},{role:'user',content:[{type:'tool_result',tool_use_id:call.id,content:[{type:'text',text:'21 C'}]}]}]},headers);
  assert.equal(second.status,200);assert.equal(second.data.stop_reason,'end_turn');assert.equal(second.data.content[0].text,'Hangzhou: 21 C');
  assert.equal((await api('/v1/messages/count_tokens','POST',body,headers)).status,200);
});

test('Messages SSE provides complete tool input and stops with tool_use, not text stop',async t=>{
  const {base,add}=await harness(t,{},toolReply);await add('message stream','sess_msgstream');
  const response=await fetch(base+'/v1/messages',{method:'POST',body:JSON.stringify({model:'test-fast',max_tokens:128,stream:true,messages:[{role:'user',content:'Weather'}],tools:messageTools,tool_choice:{type:'tool',name:'get_weather'}})});
  const text=await response.text(),frames=sseFrames(text);
  assert.deepEqual(frames.map(f=>f.event),['message_start','content_block_start','content_block_delta','content_block_stop','message_delta','message_stop']);
  assert.equal(frames[0].data.message.stop_reason,null);assert.equal(frames[1].data.content_block.type,'tool_use');
  assert.deepEqual(JSON.parse(frames[2].data.delta.partial_json),{city:'Hangzhou'});
  assert.equal(frames[4].data.delta.stop_reason,'tool_use');assert.equal(frames[4].data.usage.output_tokens,8);assert.ok(!text.includes('[DONE]'));
});

test('Messages accepts inline system/developer instructions without changing their order or role', async t => {
  const { api, base, add, hits } = await harness(t, {}, () => textEvents('Instructions received'));
  await add('mixed roles', 'sess_mixedroles');
  const body = { model: 'test-fast', system: [{ type: 'text', text: 'TOP_SYSTEM' }], messages: [
    { role: 'system', content: 'INLINE_SYSTEM' },
    { role: 'developer', content: [{ type: 'text', text: 'INLINE_DEVELOPER' }] },
    { role: 'user', content: 'hello' },
    { role: 'system', content: [{ type: 'text', text: 'LATER_SYSTEM' }] },
    { role: 'user', content: 'continue' },
  ] };
  const result = await api('/v1/messages', 'POST', body);
  assert.equal(result.status, 200); assert.equal(result.data.type, 'message');
  assert.equal(hits.at(-1).body.prompt, '[system]\nTOP_SYSTEM\n\n[system]\nINLINE_SYSTEM\n\n[developer]\nINLINE_DEVELOPER\n\nhello\n\n[system]\nLATER_SYSTEM\n\ncontinue');
  const hitCount = hits.length;
  assert.equal((await api('/v1/messages/count_tokens', 'POST', body)).status, 200);
  assert.equal(hits.length, hitCount);
  const stream = await fetch(base + '/v1/messages', { method: 'POST', body: JSON.stringify({ ...body, stream: true }) });
  assert.equal(stream.status, 200);
  const frames = sseFrames(await stream.text());
  assert.equal(frames[0].event, 'message_start'); assert.equal(frames.at(-1).event, 'message_stop');
  assert.ok(frames.some(frame => frame.data.delta?.text));
});

test('Messages handles Chat-style tools and mixed tool history with native Messages responses', async t => {
  const { api, add, hits } = await harness(t, {}, toolReply); await add('mixed tools', 'sess_mixedtools');
  const body = { model: 'test-fast', system: 'TOP_SYSTEM', messages: [
    { role: 'developer', content: 'DEVELOPER_INSTRUCTION' }, { role: 'user', content: 'Weather in Hangzhou' },
  ], tools: chatTools, tool_choice: { type: 'function', function: { name: 'get_weather' } } };
  const first = await api('/v1/messages', 'POST', body);
  assert.equal(first.status, 200); assert.equal(first.data.stop_reason, 'tool_use');
  const call = first.data.content[0]; assert.equal(call.type, 'tool_use'); assert.equal(call.name, 'get_weather');
  const chatCall = { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) } };
  for (const [assistant, result] of [
    [{ role: 'assistant', content: null, tool_calls: [chatCall] }, { role: 'tool', tool_call_id: call.id, content: '21 C' }],
    [{ role: 'assistant', content: [call] }, { role: 'tool', tool_call_id: call.id, content: [{ type: 'text', text: '21 C' }] }],
    [{ role: 'assistant', tool_calls: [chatCall] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: '21 C' }] }],
  ]) {
    const continued = { ...body, tools: messageTools, tool_choice: { type: 'auto' }, messages: [...body.messages, assistant, result] };
    const response = await api('/v1/messages', 'POST', continued);
    assert.equal(response.status, 200); assert.equal(response.data.stop_reason, 'end_turn');
    assert.equal(response.data.content[0].text, 'Hangzhou: 21 C');
    const prompt = hits.at(-1).body.prompt;
    assert.ok(prompt.includes('TOP_SYSTEM')); assert.ok(prompt.includes('DEVELOPER_INSTRUCTION'));
    assert.ok(prompt.includes(call.id)); assert.ok(prompt.includes('21 C'));
    assert.equal((await api('/v1/messages/count_tokens', 'POST', continued)).status, 200);
  }
});

test('Messages mixed-role compatibility still rejects malformed and unmatched tool history before upstream', async t => {
  const { api, hits } = await harness(t);
  const call = { role: 'assistant', content: null, tool_calls: [{ id: 'call_test', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] };
  const result = { role: 'tool', tool_call_id: 'call_test', content: '21 C' };
  for (const messages of [
    [result],
    [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_test', content: '21 C' }] }],
    [call, { ...result, tool_call_id: 'missing' }],
    [call, result, result],
    [call, call, result],
    [{ role: 'tool', content: 'missing ID' }],
    [{ role: 'user', content: 'hello', tool_calls: call.tool_calls }],
    [{ role: 'assistant', content: null, tool_calls: [{ ...call.tool_calls[0], function: { name: 'get_weather', arguments: '{broken' } }] }],
    [{ role: 'unknown', content: 'hello' }],
  ]) {
    for (const path of ['/v1/messages', '/v1/messages/count_tokens']) {
      const response = await api(path, 'POST', { model: 'test-fast', messages });
      assert.equal(response.status, 400); assert.equal(response.data.type, 'error');
      assert.equal(response.data.error.type, 'invalid_request_error');
    }
  }
  assert.equal(hits.length, 0);
});

test('new protocols keep ordinary text streaming and emit their own terminal error events',async t=>{
  for(const protocol of ['responses','messages'])await t.test(protocol,async t=>{
    const {api,base,add,pool}=await harness(t,{},body=>body.prompt.includes('FAIL_STREAM')?[{type:'error',errorText:'deliberate failure'}]:textEvents('Hello world'));
    const account=await add(protocol,'sess_plain');
    const body=protocol==='responses'?{model:'test-fast',input:'hello'}:{model:'test-fast',max_tokens:128,messages:[{role:'user',content:'hello'}]};
    const response=await api('/v1/'+protocol,'POST',body);assert.equal(response.status,200);
    const stream=await fetch(base+'/v1/'+protocol,{method:'POST',body:JSON.stringify({...body,stream:true})});
    const frames=sseFrames(await stream.text());
    assert.ok(frames.some(f=>f.event===(protocol==='responses'?'response.output_text.delta':'content_block_delta')));
    assert.equal(frames.at(-1).event,protocol==='responses'?'response.completed':'message_stop');
    const bad=protocol==='responses'?{...body,input:'FAIL_STREAM'}:{...body,messages:[{role:'user',content:'FAIL_STREAM'}]};
    const failure=await fetch(base+'/v1/'+protocol,{method:'POST',body:JSON.stringify({...bad,stream:true})});
    const failedFrames=sseFrames(await failure.text());
    assert.equal(failedFrames.at(-1).event,protocol==='responses'?'response.failed':'error');
    assert.ok(!failedFrames.some(f=>['response.completed','message_stop'].includes(f.event)));
    pool.runtimeFor(account.id).cooldownUntil=0;
    const badJson=await api('/v1/'+protocol,'POST',null);assert.equal(badJson.status,400);
    if(protocol==='messages')assert.equal(badJson.data.type,'error');
  });
});

test('tool_choice none, required failures and unknown tools do not manufacture successful calls',async t=>{
  let answer=JSON.stringify({content:null,tool_calls:[{name:'not_declared',arguments:{city:'X'}}]});
  const {api,add}=await harness(t,{},()=>textEvents(answer));await add('validation','sess_validate');
  const body={model:'test-fast',messages:[{role:'user',content:'Weather'}],tools:chatTools,tool_choice:'required'};
  let response=await api('/v1/chat/completions','POST',body);assert.equal(response.status,502);assert.equal(response.data.error.code,'tool_generation_error');
  answer='I cannot do that';response=await api('/v1/chat/completions','POST',body);assert.equal(response.status,502);
  response=await api('/v1/chat/completions','POST',{...body,tool_choice:'none'});assert.equal(response.status,200);assert.equal(response.data.choices[0].message.content,answer);assert.equal(response.data.choices[0].message.tool_calls,undefined);
  answer=JSON.stringify({tool_calls:[{name:'get_weather',arguments:{city:'Hangzhou'}},{name:'get_weather',arguments:{city:'Beijing'}}]});
  assert.equal((await api('/v1/chat/completions','POST',{...body,parallel_tool_calls:false})).status,502);
  const valid=await api('/v1/chat/completions','POST',body);assert.equal(valid.data.choices[0].message.tool_calls.length,2);
  assert.equal((await api('/v1/chat/completions','POST',{...body,tool_choice:{type:'function',function:{name:'unknown'}}})).status,400);
  assert.equal((await api('/v1/responses','POST',{input:[{type:'function_call_output',call_id:'missing',output:'x'}]})).status,400);
});

test('native AI SDK client tool inputs are parsed once, and provider-executed calls are not duplicated',async t=>{
  let executed=false;
  const {api,add}=await harness(t,{},()=>[
    {type:'tool-input-start',toolCallId:'native_call',toolName:'get_weather'},
    {type:'tool-input-delta',toolCallId:'native_call',inputTextDelta:'{"city":'},
    {type:'tool-input-delta',toolCallId:'native_call',inputTextDelta:'"Hangzhou"}'},
    {type:'tool-input-available',toolCallId:'native_call',toolName:'get_weather',input:{city:'Hangzhou'}},
    ...(executed?[{type:'tool-output-available',toolCallId:'native_call',output:'21 C'},{type:'text-delta',delta:'Hangzhou: 21 C'}]:[]),
    {type:'finish'}]);
  await add('native','sess_native');
  const body={model:'test-fast',input:'weather',tools:responseTools};
  const call=(await api('/v1/responses','POST',body)).data.output[0];assert.equal(call.type,'function_call');assert.deepEqual(JSON.parse(call.arguments),{city:'Hangzhou'});
  executed=true;const result=(await api('/v1/responses','POST',body)).data;
  assert.ok(result.output.every(i=>i.type!=='function_call'));assert.equal(result.output[0].content[0].text,'Hangzhou: 21 C');
});

test('client function named web_search is not silently replaced by upstream web search',async t=>{
  const {api,add,hits}=await harness(t,{},()=>textEvents(JSON.stringify({tool_calls:[{name:'web_search',arguments:{query:'test'}}]})));
  await add('client search','sess_search');
  const response=await api('/v1/chat/completions','POST',{model:'test-fast',messages:[{role:'user',content:'Search'}],tools:[{type:'function',function:{name:'web_search',parameters:{type:'object',properties:{query:{type:'string'}}}}}]});
  assert.equal(response.data.choices[0].message.tool_calls[0].function.name,'web_search');assert.equal(hits.at(-1).body.forcedTool,undefined);
});

test('Responses custom tools preserve free-form input and round-trip custom_tool_call_output',async t=>{
  const {api,add}=await harness(t,{},body=>textEvents(JSON.stringify(body.prompt.includes('"role":"tool"')?{content:'Done',tool_calls:[]}:{tool_calls:[{name:'write_patch',input:'*** Begin Patch\n*** End Patch'}]})));
  await add('custom','sess_custom');
  const tools=[{type:'custom',name:'write_patch',description:'Prepare patch text',format:{type:'text'}}];
  const first=(await api('/v1/responses','POST',{input:'Prepare a patch',tools})).data,call=first.output[0];
  assert.equal(call.type,'custom_tool_call');assert.ok(call.input.startsWith('*** Begin Patch'));
  const second=await api('/v1/responses','POST',{previous_response_id:first.id,input:[{type:'custom_tool_call_output',call_id:call.call_id,output:'Applied'}],tools});
  assert.equal(second.status,200);assert.equal(second.data.output[0].content[0].text,'Done');
});

function assistantFixtures() {
  return new Map([
    ['owned-assistant',{id:'owned-assistant',name:'Owned assistant',modelId:'test-slow',systemPrompt:'ORIGINAL_UPSTREAM_PROMPT',description:'Keep this description',features:{'web-search':true,'image-generation':false},conversationStarters:['Hello'],permissions:'owner',visibility:'private',isDraft:false}],
    ['readonly-assistant',{id:'readonly-assistant',name:'Shared assistant',modelId:'test-fast',systemPrompt:'READ_ONLY_PROMPT',permissions:'viewer',visibility:'shared',isDraft:false}],
  ]);
}

test('assistant prompts are read from upstream, backed up separately, and saved through draft + publish',async t=>{
  const fixtures=assistantFixtures();const {api,add,file,hits}=await harness(t,{},undefined,fixtures);const account=await add('prompt account','sess_prompt');
  const base=`/api/accounts/${account.id}/assistants`;
  assert.equal((await api(base)).data.data.length,2);
  const first=(await api(base+'/owned-assistant')).data.assistant;
  assert.equal(first.systemPrompt,'ORIGINAL_UPSTREAM_PROMPT');assert.equal(first.canEdit,true);
  const saved=await api(base+'/owned-assistant','PUT',{systemPrompt:'UPDATED_UPSTREAM_PROMPT',revision:first.revision});
  assert.equal(saved.status,200);assert.equal(saved.data.assistant.systemPrompt,'UPDATED_UPSTREAM_PROMPT');
  assert.equal(saved.data.assistant.originalSystemPrompt,'ORIGINAL_UPSTREAM_PROMPT');
  assert.ok(hits.some(h=>h.url==='/api/assistants'&&h.body.parentId==='owned-assistant'));
  assert.deepEqual(hits.find(h=>h.url.startsWith('/api/assistants/draft-')&&h.body.systemPrompt).body,{systemPrompt:'UPDATED_UPSTREAM_PROMPT'});
  assert.ok(hits.some(h=>h.url.endsWith('/save')));
  assert.equal(fixtures.get('owned-assistant').description,'Keep this description');
  assert.equal(fixtures.get('owned-assistant').features['web-search'],true);
  const snapshotFile=join(file,'..','assistant-prompts.json');
  assert.equal(statSync(snapshotFile).mode & 0o777,0o600);
  const snapshots=JSON.parse(readFileSync(snapshotFile));assert.equal(snapshots.snapshots[0].originalSystemPrompt,'ORIGINAL_UPSTREAM_PROMPT');
  assert.ok(!readFileSync(file,'utf8').includes('UPDATED_UPSTREAM_PROMPT'));
  assert.ok(!JSON.stringify((await api('/api/state')).data).includes('UPDATED_UPSTREAM_PROMPT'));
});

test('assistant permission checks and revision conflicts prevent unintended upstream writes',async t=>{
  const fixtures=assistantFixtures();const {api,add,hits}=await harness(t,{},undefined,fixtures);const account=await add('prompt permission','sess_prompt_permission');
  const base=`/api/accounts/${account.id}/assistants`;
  const readonly=(await api(base+'/readonly-assistant')).data.assistant;assert.equal(readonly.canEdit,false);
  assert.equal((await api(base+'/readonly-assistant','PUT',{systemPrompt:'Bad write',revision:readonly.revision})).status,403);
  const first=(await api(base+'/owned-assistant')).data.assistant;
  fixtures.get('owned-assistant').systemPrompt='Changed by another editor';
  assert.equal((await api(base+'/owned-assistant','PUT',{systemPrompt:'Stale overwrite',revision:first.revision})).status,409);
  assert.ok(!hits.some(h=>h.url==='/api/assistants'));
  assert.equal((await api(base+'/owned-assistant','PUT',{systemPrompt:'x'.repeat(30001),revision:first.revision})).status,400);
  const state=(await api('/api/state')).data;assert.equal(state.stats.active,0);assert.notEqual(state.accounts[0].status,'cooling');
});

test('new assistant publication and default selection affect all three proxy protocols',async t=>{
  const fixtures=assistantFixtures();const {api,add,hits,file}=await harness(t,{},undefined,fixtures);const account=await add('default assistant','sess_default_assistant');
  const created=await api(`/api/accounts/${account.id}/assistants`,'POST',{name:'New assistant',modelId:'test-slow',systemPrompt:'PRIVATE_ASSISTANT_PROMPT'});
  assert.equal(created.status,201);assert.equal(created.data.assistant.isDraft,false);
  const selected=created.data.assistant.id;
  assert.equal((await api(`/api/accounts/${account.id}/default-assistant`,'PUT',{assistantId:selected})).data.defaultAssistant.id,selected);
  for(const [path,body] of [['chat/completions',{messages:[{role:'user',content:'Hello'}]}],['responses',{input:'Hello'}],['messages',{messages:[{role:'user',content:'Hello'}],max_tokens:32}]]){
    const response=await api('/v1/'+path,'POST',body);assert.equal(response.status,200);assert.equal(response.data.model,'test-slow');
    assert.deepEqual(hits.filter(h=>h.url==='/api/chats').at(-1).body,{assistantId:selected});
  }
  const snapshotFile=join(file,'..','assistant-prompts.json');
  assert.equal(JSON.parse(readFileSync(snapshotFile)).defaults[account.id].id,selected);
  await api(`/api/accounts/${account.id}/default-assistant`,'PUT',{assistantId:null});
  await api('/v1/chat/completions','POST',{model:'test-fast',messages:[{role:'user',content:'Hello'}]});
  assert.deepEqual(hits.filter(h=>h.url==='/api/chats').at(-1).body,{});
});

test('existing assistant drafts are reused and snapshots survive reloading the service',async t=>{
  const fixtures=assistantFixtures();fixtures.get('owned-assistant').draftId='existing-draft';fixtures.set('existing-draft',{...fixtures.get('owned-assistant'),id:'existing-draft',parentId:'owned-assistant',isDraft:true,draftId:null,systemPrompt:'Existing draft text'});
  const {api,add,hits,file}=await harness(t,{},undefined,fixtures);const account=await add('drafts','sess_drafts');const base=`/api/accounts/${account.id}/assistants/owned-assistant`;
  const first=(await api(base)).data.assistant;assert.equal(first.hasDraft,true);assert.equal(first.systemPrompt,'Existing draft text');assert.equal(first.originalSystemPrompt,'ORIGINAL_UPSTREAM_PROMPT');
  const saved=await api(base,'PUT',{systemPrompt:'Final draft',revision:first.revision});assert.equal(saved.status,200);
  assert.ok(!hits.some(h=>h.url==='/api/assistants'));
  const {AssistantPrompts}=await import('../assistants.mjs');
  const cache=new AssistantPrompts(join(file,'..','assistant-prompts.json'),()=>{throw new Error('should not call upstream');});
  assert.equal(cache.data.snapshots[0].systemPrompt,'Final draft');assert.equal(cache.data.snapshots[0].originalSystemPrompt,'ORIGINAL_UPSTREAM_PROMPT');
  await api(`/api/accounts/${account.id}`,'DELETE');
  assert.equal(JSON.parse(readFileSync(join(file,'..','assistant-prompts.json'))).snapshots.length,0);
});
