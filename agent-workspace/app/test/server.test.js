import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { OpenCode } from '../src/opencode.js';
import { request } from 'node:http';

test('HTTP boundary requires login, denies cross-origin writes and rejects arbitrary proxy paths',async t=>{
  const workspace={data:{projects:[],templates:[],tasks:[]}};
  const runtime={health:async()=>({healthy:true}),catalog:async()=>[{id:'deepseek',models:[]}]};
  const server=createApp(workspace,runtime,'test-password-for-local-only');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/state')).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'test-password-for-local-only'})});
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/api/state',{headers:{cookie}})).status,200);
  assert.equal((await fetch(base+'/api/projects',{method:'POST',headers:{cookie,origin:'https://untrusted.invalid','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/config',{headers:{cookie}})).status,404);
  const wrongHost = await new Promise((resolve,reject)=>{
    const req=request(base+'/api/state',{headers:{cookie,host:'untrusted.invalid'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.end();
  });
  assert.equal(wrongHost,403);
  const page=await fetch(base);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  await fetch(base+'/api/logout',{method:'POST',headers:{cookie}});
  assert.equal((await fetch(base+'/api/state',{headers:{cookie}})).status,401);
});
test('runtime credentials cannot be sent to non-loopback or embedded URL destinations',()=>{
  assert.throws(()=>new OpenCode('https://example.com','secret'),/loopback/);
  assert.throws(()=>new OpenCode('http://user:pass@localhost:4096','secret'),/loopback/);
  assert.throws(()=>new OpenCode('http://localhost:4096',''),/password/);
});
