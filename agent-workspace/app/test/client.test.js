import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageDrafts, taskFromHash, taskURL, requestAPI } from '../public/app.js';

const storage = () => { const items=new Map(); return { getItem:key=>items.get(key)||null,setItem:(key,value)=>items.set(key,value) }; };

test('a task link opens the exact task without copying credentials or unrelated query parameters', () => {
  const url=taskURL('https://mini.example.ts.net/?secret=not-for-sharing','task-123');
  assert.equal(url,'https://mini.example.ts.net/#task=task-123');
  assert.equal(taskFromHash(new URL(url).hash),'task-123');
  for(const hash of ['#task=../secret','#task=task-1&token=abc','#task=','not-a-link'])assert.equal(taskFromHash(hash),null);
  for(const origin of ['javascript:alert(1)','https://user:secret@example.com'])assert.throws(()=>taskURL(origin,'task-1'));
});

test('lost message response and page reload reuse the same request ID until acknowledged', () => {
  const saved=storage(),first=new MessageDrafts(saved);
  first.edit('task-1','  original instruction  ');
  const sent=first.prepare('task-1',()=> 'request-1');
  const reload=new MessageDrafts(saved);
  reload.edit('task-1','a new draft typed while waiting');
  assert.deepEqual(reload.prepare('task-1',()=> 'must-not-be-used'),sent);
  assert.equal(reload.reconcile('task-1',[]),false);
  assert.equal(reload.reconcile('task-1',[{requestID:'request-1',text:'wrong text'}]),false);
  assert.equal(reload.reconcile('task-1',[{...sent,status:'queued'}]),true);
  assert.equal(reload.get('task-1').text,'a new draft typed while waiting');
  assert.equal(reload.prepare('task-1',()=> 'request-2').requestID,'request-2');
});

test('acknowledgement preserves edits and cannot clear a different task or newer attempt', () => {
  const drafts=new MessageDrafts(storage());
  drafts.edit('a','first');drafts.edit('b','second');
  drafts.prepare('a',()=> 'a1');drafts.prepare('b',()=> 'b1');
  drafts.edit('a','edited before the response');
  assert.equal(drafts.acknowledge('b','a1'),false);
  drafts.acknowledge('a','a1');
  assert.equal(drafts.get('a').text,'edited before the response');
  assert.equal(drafts.get('b').pending.requestID,'b1');
  drafts.prepare('a',()=> 'a2');
  assert.equal(drafts.acknowledge('a','a1'),false);
  drafts.acknowledge('a','a2');
  assert.equal(drafts.get('a').text,'');
  drafts.edit('a','edited before the response');
  assert.equal(drafts.prepare('a',()=> 'a3').requestID,'a3','intentional repeat after acknowledgement is a new instruction');
});

test('a new instruction is not sent when its request ID cannot be retained', () => {
  const drafts=new MessageDrafts({getItem:()=>null,setItem(){throw new Error('quota');}});
  drafts.edit('a','keep this draft');
  assert.throws(()=>drafts.prepare('a',()=> 'a1'),/보내지 않았습니다/);
  assert.equal(drafts.get('a').text,'keep this draft');
  assert.equal(drafts.get('a').pending,null);
});

test('API client preserves HTTP status and times out without retrying a write', async () => {
  await assert.rejects(()=>requestAPI('/tasks/a/permissions',{},async()=>new Response(JSON.stringify({error:'already handled'}),{status:409})),error=>error.status===409);
  await assert.rejects(()=>requestAPI('/state',undefined,async()=>new Response('not json',{status:401})),error=>error.status===401);
  let calls=0;
  await assert.rejects(()=>requestAPI('/tasks/a/messages',{text:'once'},async(path,options)=>{
    calls++;assert.equal(options.redirect,'error');assert.equal(options.credentials,'same-origin');
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  },10),/초과/);
  assert.equal(calls,1);
});
