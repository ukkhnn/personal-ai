// Explicit opt-in: this test uses the user's existing OpenCode credentials and
// makes two short model requests, confined to a temporary fixture repository.
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { Workspace } from '../src/workspace.js';
import { launchRuntime } from '../src/opencode.js';
import { createApp } from '../src/server.js';
import { git } from '../src/git.js';

if (process.env.LIVE_MODEL_TEST !== '1') throw new Error('Set LIVE_MODEL_TEST=1 to opt into a small billable integration test.');
const dir=await mkdtemp(join(tmpdir(),'personal-ai-live-'));
const repo=join(dir,'fixture'),data=join(dir,'data');await mkdir(repo);await mkdir(data);
await git(repo,['init','-b','main']);await writeFile(join(repo,'README.md'),'Temporary integration fixture.\n');await git(repo,['add','.']);
await git(repo,['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);
const instance=await launchRuntime(data);
const workspace=new Workspace(new Store(data),instance.runtime,data);
const password=randomBytes(24).toString('base64url');
const server=createApp(workspace,instance.runtime,password);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;let cookie;
async function api(path,body) {
  const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
  if(response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
  const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value;
}
try {
  await api('/login',{password});
  const catalog=await api('/runtime');console.log('Runtime:',catalog.health.version);
  const project=await api('/projects',{directory:repo});
  const template=await api('/templates',{name:'Smoke',model:{providerID:'deepseek',modelID:process.env.LIVE_MODEL_ID || 'deepseek-flash'},prompt:'Follow the tiny test exactly. No subagents. No network tools.',memory:'This is a disposable test fixture.'});
  const task=await api('/tasks',{projectID:project.id,templateID:template.id,title:'Integration smoke'});
  if (!task.sessionID) throw new Error(task.error);
  await api(`/tasks/${task.id}/messages`,{requestID:'smoke-1',text:'Use a file editing tool to create smoke.txt containing exactly hello-workspace followed by a newline. Then run exactly git diff --stat using the shell tool. No other shell commands. Reply briefly when done.'});
  await api(`/tasks/${task.id}/messages`,{requestID:'smoke-2',text:'Read smoke.txt using a file reading tool and reply with its contents only. Do not change any files or run commands.'});
  workspace.start();let last='',approved=0;
  for(let n=0;n<180;n++) {
    await delay(1000);const t=await api(`/tasks/${task.id}`);
    const state=`${t.status}: ${t.queue.map(m=>m.status).join(',')}`;
    if(state!==last){console.log(state);last=state;}
    for(const request of t.permissions) {
      if(request.permission==='bash' && request.patterns.every(p=>/^git diff(?: --stat)?(?: \*)?$/.test(p))) {
        await api(`/tasks/${t.id}/permissions`,{id:request.id,reply:'once'});approved++;
      } else { console.log('Unexpected approval:',request.permission,JSON.stringify(request.patterns));throw new Error('Unexpected approval; test stops without granting it.'); }
    }
    if(t.queue.every(m=>m.status==='completed')) {
      if((await readFile(join(t.directory,'smoke.txt'),'utf8'))!=='hello-workspace\n')throw new Error('File contents differ.');
      const diff=await api(`/tasks/${t.id}/changes`);if(!diff.status.includes('smoke.txt'))throw new Error('Missing worktree changes.');
      if(!approved)throw new Error('No approval boundary exercised.');
      console.log('PASS: authenticated HTTP, worktree, template/model, two queued turns, approval, file result, change listing.');
      console.log(`Fixture retained at ${dir}`);
      break;
    }
    if(t.status==='failed' || t.status==='interrupted' || t.status==='setup_failed')throw new Error(t.error);
    if(n===179)throw new Error('Timed out waiting for model execution.');
  }
} finally {
  for(const task of workspace.data.tasks) if(task.current) {try{await workspace.stop(task.id);}catch{}}
  await workspace.close();server.close();server.closeAllConnections();await instance.close();
}
