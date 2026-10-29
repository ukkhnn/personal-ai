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
  await assert.rejects(()=>f.workspace.approve(f.task.id,'per1','once'),/이 작업/);
  assert.equal(f.runtime.replies.length,1);
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
