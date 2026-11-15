import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Workspace } from '../src/workspace.js';
import { git } from '../src/git.js';

import { FakeRuntime } from './helpers/fake-runtime.js';

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'personal-ai-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const repo=join(dir,'repo'); await import('node:fs/promises').then(fs=>fs.mkdir(repo));
  await git(repo,['init','-b','main']);await writeFile(join(repo,'hello.txt'),'original\n');await git(repo,['add','.']);
  await git(repo,['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);
  const runtime=new FakeRuntime(),data=join(dir,'data'),store=new Store(data),workspace=new Workspace(store,runtime,data);
  const project=await workspace.addProject({directory:repo});
  const template=await workspace.addTemplate({name:'dev',model:{providerID:'deepseek',modelID:'test'},prompt:'test',memory:'context'});
  const task=await workspace.createTask({projectID:project.id,templateID:template.id,title:'task'});
  return {dir,repo,runtime,data,store,workspace,project,template,task};
}
test('worktrees isolate edits and tasks snapshot the template',async t=>{
  const f=await fixture(t);
  const other=await f.workspace.createTask({projectID:f.project.id,templateID:f.template.id,title:'other'});
  await writeFile(join(f.task.directory,'hello.txt'),'changed\n');
  assert.equal(await readFile(join(other.directory,'hello.txt'),'utf8'),'original\n');
  assert.equal(await readFile(join(f.repo,'hello.txt'),'utf8'),'original\n');
  assert.notEqual(other.branch,f.task.branch);
  f.template.prompt='new';assert.equal(f.task.template.prompt,'test');
  assert.match((await f.workspace.changes(f.task.id)).diff,/changed/);
});
test('queue deduplicates retries, waits for completion, and survives restart without re-sending',async t=>{
  const f=await fixture(t);
  const input={text:'first',requestID:'request-1'};
  await f.workspace.enqueue(f.task.id,input);await f.workspace.enqueue(f.task.id,input);
  await assert.rejects(()=>f.workspace.enqueue(f.task.id,{...input,text:'other'}),/다른 메시지/);
  await f.workspace.tick(f.task.id);
  await f.workspace.enqueue(f.task.id,{text:'second',requestID:'request-2'});
  await f.workspace.tick(f.task.id);
  assert.equal(f.runtime.sent.length,1);
  const restored=new Workspace(new Store(f.data),f.runtime,f.data);
  await restored.tick(f.task.id);assert.equal(f.runtime.sent.length,1);
  f.runtime.finish(restored.task(f.task.id));await restored.tick(f.task.id);
  assert.equal(f.runtime.sent.length,2);
  assert.equal(restored.task(f.task.id).queue[0].status,'completed');
});
test('stop preserves queued instructions and edits; only explicit resume starts the next message',async t=>{
  const f=await fixture(t);
  await f.workspace.enqueue(f.task.id,{text:'first',requestID:'1'});await f.workspace.tick(f.task.id);
  await f.workspace.enqueue(f.task.id,{text:'second',requestID:'2'});
  await writeFile(join(f.task.directory,'hello.txt'),'keep me');
  await f.workspace.stop(f.task.id);await f.workspace.tick(f.task.id);
  assert.equal(f.task.status,'stopped');assert.equal(f.runtime.sent.length,1);
  assert.equal(f.task.queue[0].status,'cancelled');assert.equal(f.task.queue[1].status,'queued');
  assert.equal(await readFile(join(f.task.directory,'hello.txt'),'utf8'),'keep me');
  await f.workspace.resume(f.task.id);await f.workspace.tick(f.task.id);assert.equal(f.runtime.sent.length,2);
});
test('permissions are checked against a fresh snapshot of the selected task',async t=>{
  const f=await fixture(t);
  f.runtime.sessions.get(f.task.sessionID).permissions=[{id:'per1',sessionID:f.task.sessionID}];
  await assert.rejects(()=>f.workspace.approve(f.task.id,'per-other','once'),/이 작업/);
  await assert.rejects(()=>f.workspace.approve(f.task.id,'per1','always'),/한 번/);
  await f.workspace.approve(f.task.id,'per1','once');
  await assert.rejects(()=>f.workspace.approve(f.task.id,'per1','once'),/이미 처리/);
  assert.equal(f.runtime.replies.length,1);
});

test('simultaneous approval and rejection are serialized and visible after reconnect', async t => {
  const f=await fixture(t);
  f.runtime.sessions.get(f.task.sessionID).permissions=[{id:'race',sessionID:f.task.sessionID,permission:'bash',patterns:['git diff *'],metadata:{command:'git diff --stat'}}];
  const results=await Promise.allSettled([
    f.workspace.approve(f.task.id,'race','reject'), f.workspace.approve(f.task.id,'race','once'),
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
  assert.deepEqual(f.runtime.replies,[{task:f.task.id,id:'race',reply:'reject'}]);
  const restored=new Workspace(new Store(f.data),f.runtime,f.data);
  const decision=restored.task(f.task.id).permissionDecisions[0];
  assert.equal(decision.reply,'reject');assert.equal(decision.status,'applied');
  assert.equal(decision.command,'git diff --stat');
  await assert.rejects(()=>restored.approve(f.task.id,'race','once'),error=>error.status===409);
  assert.equal(f.runtime.replies.length,1);
});

test('lost approval response and restart never resend an ambiguous decision', async t => {
  const f=await fixture(t);let sends=0;
  f.runtime.sessions.get(f.task.sessionID).permissions=[{id:'uncertain',sessionID:f.task.sessionID}];
  f.runtime.reply=async()=>{
    sends++;
    assert.equal(new Store(f.data).data.tasks[0].permissionDecisions[0].status,'sending','decision is saved before delivery');
    throw new Error('reply accepted but network response lost');
  };
  await assert.rejects(()=>f.workspace.approve(f.task.id,'uncertain','once'),error=>error.status===502);
  const restored=new Workspace(new Store(f.data),f.runtime,f.data);
  assert.equal(restored.task(f.task.id).permissionDecisions[0].status,'uncertain');
  for(const reply of ['once','reject'])await assert.rejects(()=>restored.approve(f.task.id,'uncertain',reply),error=>error.status===409);
  assert.equal(sends,1);
  // A process crash after the write-ahead save also blocks delivery after reload.
  restored.task(f.task.id).permissionDecisions[0].status='sending';
  delete restored.task(f.task.id).permissionDecisions[0].updatedAt;restored.store.save();
  const afterCrash=new Workspace(new Store(f.data),f.runtime,f.data);
  await assert.rejects(()=>afterCrash.approve(f.task.id,'uncertain','once'),error=>error.status===409);
  assert.equal(sends,1);
});
test('ambiguous delivery is persisted and never automatically retried',async t=>{
  const f=await fixture(t);
  let sends=0;f.runtime.send=async()=>{sends++;throw new Error('timeout');};
  await f.workspace.enqueue(f.task.id,{text:'once',requestID:'1'});await f.workspace.tick(f.task.id);
  const restored=new Workspace(new Store(f.data),f.runtime,f.data);
  await restored.tick(f.task.id);await restored.tick(f.task.id);
  assert.equal(sends,1);assert.equal(restored.task(f.task.id).paused,true);
  await assert.rejects(()=>restored.resume(f.task.id),/종료 여부/);
});
test('engine disconnect retains history and does not claim completion',async t=>{
  const f=await fixture(t);
  await f.workspace.enqueue(f.task.id,{text:'first',requestID:'1'});await f.workspace.tick(f.task.id);await f.workspace.tick(f.task.id);
  f.runtime.snapshot=async()=>{throw new Error('offline');};
  await f.workspace.tick(f.task.id);
  assert.equal(f.task.messages.length,1);assert.equal(f.task.runtimeAvailable,false);assert.equal(f.task.status,'running');
});
test('store is private and corrupted/unknown data is not silently overwritten',async t=>{
  const f=await fixture(t);assert.equal((await stat(f.store.file)).mode & 0o777,0o600);
  await writeFile(f.store.file,'{broken');assert.throws(()=>new Store(f.data));
  assert.equal(await readFile(f.store.file,'utf8'),'{broken');
  await writeFile(f.store.file,JSON.stringify({version:999,projects:[],tasks:[],templates:[]}));
  assert.throws(()=>new Store(f.data),/Unsupported/);
});

test('server timer processes queued work and approvals without a connected client', async t => {
  const f = await fixture(t);
  // close before the fixture directory is removed by its cleanup hook.
  try {
    const originalSend = f.runtime.send.bind(f.runtime);
    f.runtime.send = async (task, message) => {
      await originalSend(task, message);
      if (message.requestID === 'first') {
        f.runtime.sessions.get(task.sessionID).permissions = [{ id: 'approval1', sessionID: task.sessionID }];
      } else f.runtime.finish(task);
    };
    const originalReply = f.runtime.reply.bind(f.runtime);
    f.runtime.reply = async (...args) => { await originalReply(...args); f.runtime.finish(args[0]); };
    await f.workspace.enqueue(f.task.id, { text: 'first', requestID: 'first' });
    await f.workspace.enqueue(f.task.id, { text: 'follow-up', requestID: 'second' });
    f.workspace.start();
    const until = async predicate => {
      const deadline = Date.now() + 10000;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, 'server timer did not progress');
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    };
    // No tick(), HTTP request, or client polling drives execution here.
    await until(() => f.task.status === 'waiting_approval');
    assert.equal(f.runtime.sent.length, 1);
    assert.equal(f.task.queue[1].status, 'queued');
    await f.workspace.approve(f.task.id, 'approval1', 'once');
    await until(() => f.task.queue.every(message => message.status === 'completed'));
    assert.equal(f.runtime.sent.length, 2);
    assert.equal(f.task.status, 'completed');
    const persisted = new Store(f.data).data.tasks.find(task => task.id === f.task.id);
    assert.ok(persisted.queue.every(message => message.status === 'completed'));
  } finally { await f.workspace.close(); }
});
