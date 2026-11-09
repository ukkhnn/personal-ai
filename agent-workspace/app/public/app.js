// The same module is imported by socket-free client tests; DOM startup is gated.
export function taskFromHash(hash) {
  return /^#task=([a-zA-Z0-9-]{1,100})$/.exec(hash || '')?.[1] || null;
}
export function taskURL(origin, id) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id || '')) throw new Error('올바른 작업 ID가 필요합니다.');
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('올바른 서버 주소가 필요합니다.');
  return `${url.origin}/#task=${id}`;
}

export class MessageDrafts {
  constructor(storage) { this.storage=storage; this.cache=new Map(); this.storageAvailable=true; }
  get(id) {
    if (!this.cache.has(id)) {
      let value={text:'',pending:null};
      try {
        const saved=JSON.parse(this.storage.getItem(`workspace:message:${id}`) || 'null');
        if (saved && typeof saved.text==='string' && saved.text.length<=20000) {
          value.text=saved.text;
          if (saved.pending && typeof saved.pending.text==='string' && saved.pending.text.trim()
              && saved.pending.text.length<=20000 && /^[a-zA-Z0-9-]{1,100}$/.test(saved.pending.requestID || '')) {
            value.pending={text:saved.pending.text,requestID:saved.pending.requestID};
          }
        }
      } catch { this.storageAvailable=false; }
      this.cache.set(id,value);
    }
    return this.cache.get(id);
  }
  save(id,value,required=false) {
    try { this.storage.setItem(`workspace:message:${id}`,JSON.stringify(value)); this.storageAvailable=true; }
    catch {
      this.storageAvailable=false;
      if (required) throw new Error('이 탭에 전송 ID를 보존할 수 없어 보내지 않았습니다. 브라우저 저장 공간 설정을 확인하세요.');
    }
    this.cache.set(id,value); return value;
  }
  edit(id,text) { return this.save(id,{...this.get(id),text}); }
  prepare(id,newID) {
    const current=this.get(id);
    if (current.pending) return {...current.pending};
    const text=current.text.trim();
    if (!text || text.length>20000) throw new Error('추가 지시는 1~20,000자 이내로 입력하세요.');
    const pending={text,requestID:newID()};
    this.save(id,{...current,pending},true); return {...pending};
  }
  acknowledge(id,requestID) {
    const current=this.get(id);
    if (current.pending?.requestID!==requestID) return false;
    this.save(id,{text:current.text.trim()===current.pending.text?'':current.text,pending:null});
    return true;
  }
  reconcile(id,queue) {
    const pending=this.get(id).pending;
    return !!pending && queue.some(message=>message.requestID===pending.requestID && message.text===pending.text)
      && this.acknowledge(id,pending.requestID);
  }
}

export class ApiError extends Error {
  constructor(message,status=0) { super(message); this.status=status; }
}
export async function requestAPI(path,input,fetcher=globalThis.fetch,timeout=15000) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetcher(`/api${path}`,{
      method:input===undefined?'GET':'POST', credentials:'same-origin', cache:'no-store', redirect:'error', signal:controller.signal,
      ...(input===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),
    });
    let data;
    try { data=await response.json(); }
    catch { throw new ApiError('서버 응답을 읽지 못했습니다. 전송 상태를 확인하세요.',response.status); }
    if (!response.ok) throw new ApiError(data.error||'요청 실패',response.status);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(controller.signal.aborted?'연결 확인 시간이 초과됐습니다. 전송 여부를 확인한 뒤 다시 시도하세요.':'서버에 연결하지 못했습니다. 연결을 복구한 뒤 다시 확인하세요.');
  } finally { clearTimeout(timer); }
}

export function boot() {
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(className)n.className=className; return n; };
const icon = name => { const n=document.createElementNS('http://www.w3.org/2000/svg','svg'), u=document.createElementNS(n.namespaceURI,'use'); u.setAttribute('href',`#i-${name}`); n.append(u); return n; };
const labels={idle:'준비됨',creating:'준비 중',setup_failed:'설정 실패',running:'실행 중',waiting_approval:'승인 대기',waiting_input:'답변 대기',completed:'완료',failed:'실행 실패',stopping:'중단 확인 중',stopped:'중단됨',uncertain:'전달 확인 필요',interrupted:'실행 끊김',queued:'대기 중',sending:'전달 중',delivered:'전달됨',cancelled:'중단됨'};
let storage;
try { storage=window.sessionStorage; } catch { storage={getItem(){throw new Error();},setItem(){throw new Error();}}; }
const drafts=new MessageDrafts(storage), sendingTasks=new Set(), decidingPermissions=new Set();
let savedTask;try{savedTask=storage.getItem('task');}catch{}
let state={projects:[],templates:[],tasks:[]}, selected=taskFromHash(location.hash)||(location.hash?null:savedTask), projectFilter='', polling=false, refreshRequested=false, authenticated=false, messageSignature='', approvalSignature='', questionSignature='';
let publicOrigin=null,lastSync=null,linkOnline=true,requestGeneration=0;
function syncStatus(online) {
  linkOnline=online;
  if(!online){approvalSignature='';document.querySelectorAll('#approvals button').forEach(button=>button.disabled=true);}
  $('sync-status').textContent=online?`동기화됨 · ${new Date(lastSync).toLocaleTimeString('ko-KR')}`:`연결 확인 필요${lastSync?' · 마지막 동기화 '+new Date(lastSync).toLocaleTimeString('ko-KR'):''} · 서버 작업 상태는 재접속 후 확인하세요`;
  $('sync-status').dataset.online=String(online);$('retry-sync').hidden=online;
}
function saveSelection(id) { try { storage.setItem('task',id||''); } catch {} }
function composerState() {
  const draft=selected?drafts.get(selected):{pending:null};
  $('pending-message').hidden=!draft.pending;
  $('pending-text').textContent=draft.pending?draft.pending.text.slice(0,300)+(draft.pending.text.length>300?'…':''):'';
  $('retry-message').disabled=!authenticated||!selected||sendingTasks.has(selected)||!linkOnline;
  $('message-form').querySelector('button[type=submit]').disabled=!selected||!!draft.pending||sendingTasks.has(selected)||!linkOnline;
  $('draft-note').textContent=drafts.storageAvailable?'초안은 이 탭에 보관됩니다. 다른 기기에는 전송된 지시가 표시됩니다.':'이 탭의 저장 공간을 사용할 수 없습니다. 새로고침하면 초안이 사라질 수 있습니다.';
}

async function api(path,input){
  const generation=requestGeneration;
  try{return await requestAPI(path,input);}
  catch(error){
    if(error.status===401 && generation===requestGeneration){
      authenticated=false;requestGeneration++;$('login').hidden=false;$('app').hidden=true;
      document.querySelectorAll('dialog[open]').forEach(d=>d.close());
      $('login-error').textContent='로그인이 만료됐습니다. 다시 로그인하면 같은 작업을 이어갑니다.';
    }
    if(!error.status)syncStatus(false);
    throw error;
  }
}
function notice(error){
  document.querySelectorAll('.dialog-error').forEach(n=>n.remove());
  $('notice').textContent=error?.message||'';$('notice').hidden=!error;
  const dialog=document.querySelector('dialog[open]');
  if(error&&dialog)dialog.prepend(el('p',error.message,'error dialog-error'));
}
function options(id,items,label){
  const select=$(id), signature=JSON.stringify(items.map(i=>[i.id,label(i)]));
  if(select.dataset.options===signature)return;
  const previous=select.value;select.replaceChildren(...items.map(i=>{const o=el('option',label(i));o.value=i.id;return o;}));
  if(items.some(i=>i.id===previous))select.value=previous;select.dataset.options=signature;
}
async function loadRuntime(){
  try{
    const data=await api('/runtime');$('connection').textContent=`OpenCode ${data.health.version||''} · 연결됨`;
    const models=data.providers.flatMap(p=>p.models.map(m=>({id:JSON.stringify({providerID:p.id,modelID:m.id}),name:`${p.name||p.id} / ${m.name}`,provider:p.id})));
    options('model',models,m=>m.name);
    $('model-help').textContent=models.length ? `이 서버에서 연결된 ${data.providers.length}개 공급자의 모델입니다. 다른 기기의 인증은 자동 이전되지 않습니다.` : '이 서버에 연결된 모델이 없습니다. 서버의 기존 공급자 인증을 확인한 뒤 새로고침하세요.';
    $('template-form').querySelector('button[type=submit]').disabled=!models.length;
    const preferred=models.find(m=>m.provider==='deepseek'&&JSON.parse(m.id).modelID.includes('flash'));if(preferred)$('model').value=preferred.id;
  }catch(error){$('connection').textContent='OpenCode 연결 확인 필요';$('model-help').textContent='모델 목록을 가져오지 못했습니다. 서버 연결을 확인하세요.';$('template-form').querySelector('button[type=submit]').disabled=true;notice(error);}
}
function sidebar(open){$('sidebar').classList.toggle('open',open);$('sidebar-backdrop').hidden=!open;}
function dialog(id){document.querySelectorAll('dialog[open]').forEach(d=>d.close());notice(null);$(id).showModal();sidebar(false);}
function tab(changes){$('conversation').hidden=changes;$('change-view').hidden=!changes;$('chat-tab').setAttribute('aria-selected',String(!changes));$('changes').setAttribute('aria-selected',String(changes));}
function selectTask(id,updateURL=true){
  if(selected)drafts.edit(selected,$('message').value);
  selected=id;saveSelection(id);$('message').value=id?drafts.get(id).text:'';
  if(updateURL)history.pushState(null,'',id?`/#task=${id}`:'/');
  messageSignature=approvalSignature=questionSignature='';sidebar(false);tab(false);
  $('link-feedback').textContent='';
  $('task-view').hidden=true;$('empty').hidden=!!id;$('toggle-inspector').hidden=true;
  renderState();composerState();void refresh();
}
function navigate(){selectTask(taskFromHash(location.hash),false);}
window.addEventListener('hashchange',navigate);window.addEventListener('popstate',navigate);

function status(task){const n=el('span',labels[task.status]||task.status,'status-badge');n.dataset.status=task.status;return n;}
function visibleTasks(){const query=$('search').value.trim().toLowerCase();return [...state.tasks].reverse().filter(t=>(!projectFilter||t.projectID===projectFilter)&&(!query||t.title.toLowerCase().includes(query)));}
function renderState(){
  options('project',state.projects,p=>p.name);options('template',state.templates,t=>t.name);
  $('task-count').textContent=state.tasks.length;$('template-count').textContent=state.templates.length;
  $('active-count').textContent=state.tasks.filter(t=>['running','waiting_approval','waiting_input'].includes(t.status)).length||'';
  $('home').classList.toggle('active',!selected&&!projectFilter);
  $('project-list').replaceChildren(...state.projects.map(p=>{const b=el('button',undefined,`project-button${projectFilter===p.id?' active':''}`);b.append(el('span',p.name.slice(0,1).toUpperCase(),'project-letter'),el('span',p.name));b.onclick=()=>{projectFilter=p.id;selectTask(null);};return b;}));
  if(!state.projects.length)$('project-list').append(el('div','아직 연결된 프로젝트가 없습니다','sidebar-empty'));
  const tasks=visibleTasks();
  $('task-list').replaceChildren(...tasks.map(t=>{const b=el('button',undefined,`task-item${selected===t.id?' active':''}`),copy=el('span',undefined,'task-copy');copy.append(el('strong',t.title),el('small',labels[t.status]||t.status));b.append(el('span',undefined,`task-indicator ${t.status}`),copy);b.onclick=()=>selectTask(t.id);return b;}));
  $('saved-templates').replaceChildren(...state.templates.map(t=>{const n=el('div',undefined,'saved-template');n.append(icon('sliders'),el('span',t.name),el('small',t.model.modelID));return n;}));
  $('overview-count').textContent=`${tasks.length}개`;
  $('overview-list').replaceChildren(...tasks.map(t=>{const b=el('button',undefined,'overview-row'),copy=el('span',undefined,'row-copy');copy.append(el('strong',t.title),el('small',state.projects.find(p=>p.id===t.projectID)?.name||'프로젝트'));b.append(el('span',undefined,`task-indicator ${t.status}`),copy,status(t),icon('chevron'));b.onclick=()=>selectTask(t.id);return b;}));
  $('onboarding').hidden=state.tasks.length>0;
  if(!tasks.length&&state.tasks.length)$('overview-list').append(el('p','조건에 맞는 작업이 없습니다.','sidebar-empty'));
  if(!selected){$('empty').hidden=false;$('task-view').hidden=true;$('toggle-inspector').hidden=true;$('overview-title').textContent=state.projects.find(p=>p.id===projectFilter)?.name||'내 작업';$('breadcrumb-project').textContent='워크스페이스';$('breadcrumb-title').textContent=projectFilter?$('overview-title').textContent:'모든 작업';}
}
function renderTask(task){
  $('empty').hidden=true;$('task-view').hidden=false;$('toggle-inspector').hidden=false;
  $('share-link').value=taskURL(publicOrigin||location.origin,task.id);$('info-task-id').textContent=task.id;
  if(drafts.reconcile(task.id,task.queue))$('message').value=drafts.get(task.id).text;
  composerState();
  $('task-name').textContent=task.title;$('breadcrumb-title').textContent=task.title;$('breadcrumb-project').textContent=state.projects.find(p=>p.id===task.projectID)?.name||'프로젝트';
  $('task-status').textContent=task.runtimeAvailable?(labels[task.status]||task.status):'연결 확인 필요';$('task-status').dataset.status=task.status;
  $('task-model').textContent=task.template.model.modelID;$('composer-model').textContent=task.template.model.modelID;
  $('info-template').textContent=task.template.name;$('info-model').textContent=`${task.template.model.providerID} / ${task.template.model.modelID}`;
  $('task-branch').textContent=task.branch;$('info-directory').textContent=task.directory||task.worktree||'';
  $('info-created').textContent=task.createdAt?new Date(task.createdAt).toLocaleString('ko-KR'):'';
  $('task-error').textContent=task.error||'';$('task-error').hidden=!task.error;
  $('resume').hidden=!task.paused||!!task.current;$('stop').disabled=!task.sessionID||!task.runtimeAvailable||['stopping','stopped','completed','idle'].includes(task.status);
  const signature=JSON.stringify(task.messages);
  if(messageSignature!==signature){
    const scroll=$('conversation-scroll'),bottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<100;
    const expanded=new Set([...$('messages').querySelectorAll('details[open]')].map(n=>n.dataset.key));
    const messages=[];
    for(const m of task.messages){
      const text=m.parts.filter(p=>p.type==='text'&&p.text).map(p=>p.text).join('\n'), tools=m.parts.filter(p=>p.type==='tool');if(!text&&!tools.length)continue;
      const box=el('article',undefined,`message ${m.info.role}`),heading=el('div',undefined,'message-heading'),body=el('div',undefined,'message-body');
      heading.append(el('span',m.info.role==='user'?'나':'p•','avatar'),el('span',m.info.role==='user'?'나':'OpenCode','role'));
      if(m.info.time?.created)heading.append(el('time',new Date(m.info.time.created).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}),'message-time'));
      if(text)body.append(el('p',text));
      for(const [index,t]of tools.entries()){
        const d=el('details',undefined,'tool'),s=el('summary');d.dataset.key=`${m.info.id}:${t.id||index}`;d.open=expanded.has(d.dataset.key);
        s.append(icon('code'),el('span',t.tool),el('span',({completed:'완료',running:'실행 중',pending:'대기',error:'오류'})[t.state?.status]||t.state?.status||'','tool-status'));
        d.append(s,el('pre',JSON.stringify(t.state?.input||{},null,2)));if(t.state?.output)d.append(el('p',String(t.state.output)));if(t.state?.error)d.append(el('p',String(t.state.error)));body.append(d);
      }
      box.append(heading,body);messages.push(box);
    }
    $('messages').replaceChildren(...messages);$('conversation-empty').hidden=messages.length>0;messageSignature=signature;
    if(bottom)scroll.scrollTop=scroll.scrollHeight;
  }
  $('queue-panel').hidden=!task.queue.length;$('queue-count').textContent=`${task.queue.filter(m=>['queued','sending','delivered'].includes(m.status)).length}개 진행 중`;
  $('queue').replaceChildren(...task.queue.slice(-20).map(m=>el('p',`${labels[m.status]||m.status} · ${m.text.slice(0,140)}`)));
  const decisions=task.permissionDecisions||[], aps=JSON.stringify([task.permissions,decisions]);
  if(approvalSignature!==aps){
    approvalSignature=aps;
    $('approvals').replaceChildren(...task.permissions.map(r=>{
      const box=el('div',undefined,'request'), decision=decisions.find(item=>item.id===r.id);
      box.append(el('h3','실행 승인이 필요합니다'),el('p',task.title,'approval-task'),el('small','실행할 명령 또는 도구'),
        el('pre',r.metadata?.command||`${r.permission}\n${(r.patterns||[]).join('\n')}`),el('small','작업 폴더'),el('pre',task.directory));
      if(decision){box.append(el('p',decision.status==='applied'?'이미 처리된 요청입니다. 실행 상태 갱신을 기다립니다.':'전달 결과 확인이 필요합니다. 중복 실행을 막기 위해 다시 전달하지 않습니다.'));return box;}
      for(const [reply,label]of [['once','이번 실행 승인'],['reject','거절']]){
        const b=el('button',label,reply==='once'?'primary':'');b.disabled=decidingPermissions.has(r.id);
        b.onclick=async()=>{
          if(decidingPermissions.has(r.id))return;
          decidingPermissions.add(r.id);box.querySelectorAll('button').forEach(button=>button.disabled=true);notice(null);
          try{await api(`/tasks/${task.id}/permissions`,{id:r.id,reply});}
          catch(error){notice(error);}
          finally{decidingPermissions.delete(r.id);approvalSignature='';await refresh();}
        };box.append(b);
      }return box;
    }));
    $('decision-history').replaceChildren(...decisions.slice(-10).reverse().map(item=>{
      const box=el('div',undefined,'decision-item');
      const outcome=item.status==='applied'?(item.reply==='once'?'승인 전달됨':'거절 전달됨'):'전달 결과 확인 필요';
      box.append(el('strong',outcome),el('time',new Date(item.updatedAt||item.createdAt).toLocaleString('ko-KR')),
        el('pre',item.command||`${item.permission||'도구'} · ${(item.patterns||[]).join(', ')}`));return box;
    }));
    $('decision-panel').hidden=!decisions.length;
  }
  const qs=JSON.stringify(task.questions);
  if(questionSignature!==qs){questionSignature=qs;$('questions').replaceChildren(...task.questions.map(r=>{const f=el('form',undefined,'request'),fields=[];for(const q of r.questions){const label=el('label',q.question),input=el('input');input.required=true;if(q.options?.length)label.append(el('small',q.options.map(o=>o.label).join(' / ')));label.append(input);f.append(label);fields.push(input);}const b=el('button','답변 전달','primary');b.type='submit';f.append(b);f.onsubmit=e=>{e.preventDefault();void action(b,()=>api(`/tasks/${task.id}/questions`,{id:r.id,answers:fields.map(i=>[i.value])}));};return f;}));}
}
async function refresh(){
  if(!authenticated)return;
  if(polling){refreshRequested=true;return;}
  polling=true;const generation=requestGeneration,selectionAtStart=selected;
  try{
    const next=await api('/state');if(generation!==requestGeneration)return;
    state=next;
    if(selected===selectionAtStart&&selected&&!state.tasks.some(t=>t.id===selected)){
      selected=null;saveSelection(null);history.replaceState(null,'','/');
      $('message').value='';notice(new Error('이 서버에서 해당 작업을 찾지 못했습니다. 작업 목록에서 다시 선택하세요.'));
    }
    renderState();
    if(selected){const id=selected,task=await api(`/tasks/${id}`);if(id===selected&&generation===requestGeneration)renderTask(task);}
    if(generation===requestGeneration){lastSync=Date.now();syncStatus(true);composerState();}
  }catch(error){if(generation===requestGeneration){syncStatus(false);composerState();notice(error);}}
  finally{polling=false;if(refreshRequested){refreshRequested=false;void refresh();}}
}
async function action(button,operation){button.disabled=true;notice(null);try{await operation();await refresh();}catch(e){notice(e);}finally{button.disabled=false;}}

function form(id,operation){$(id).onsubmit=e=>{e.preventDefault();void action($(id).querySelector('button[type=submit]'),operation);};}
async function open(){await api('/state');const system=await api('/system');publicOrigin=system.publicOrigin;$('server-location').textContent=system.access==='tailscale'?'맥미니 · 원격 연결':'맥미니 · 로컬 연결';$('server-location').title=system.publicOrigin||'원격 접속 설정 전';authenticated=true;requestGeneration++;$('login').hidden=true;$('app').hidden=false;$('message').value=selected?drafts.get(selected).text:'';if(!system.features?.permissionDecisions)notice(new Error('승인·거절 기록은 서버 업데이트 후 사용할 수 있습니다.'));await loadRuntime();await refresh();}
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-error').textContent='';try{await api('/login',{password:$('password').value});$('password').value='';await open();}catch(error){$('login-error').textContent=error.message;}};
for(const id of ['new-task','overview-new'])$(id).onclick=()=>dialog('task-dialog');
for(const id of ['open-project','setup-project','task-add-project'])$(id).onclick=()=>dialog('project-dialog');
for(const id of ['open-template','setup-template','task-add-template'])$(id).onclick=()=>dialog('template-dialog');
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('home').onclick=()=>{projectFilter='';selectTask(null);};$('search').oninput=renderState;
$('open-sidebar').onclick=()=>sidebar(true);for(const id of ['close-sidebar','sidebar-backdrop'])$(id).onclick=()=>sidebar(false);
$('toggle-inspector').onclick=()=>{if(matchMedia('(max-width:1100px)').matches)$('inspector').classList.toggle('open');else document.querySelector('.task-body').classList.toggle('hide-inspector');};
$('close-inspector').onclick=()=>$('inspector').classList.remove('open');
form('project-form',async()=>{await api('/projects',{directory:$('project-path').value});$('project-path').value='';$('project-dialog').close();});
form('template-form',async()=>{if(!$('model').value)throw new Error('연결된 모델을 먼저 선택하세요.');await api('/templates',{name:$('template-name').value,model:JSON.parse($('model').value),prompt:$('template-prompt').value,memory:$('template-memory').value});$('template-name').value='';$('template-dialog').close();});
form('task-form',async()=>{const task=await api('/tasks',{projectID:$('project').value,templateID:$('template').value,title:$('task-title').value});$('task-title').value='';$('task-dialog').close();selectTask(task.id);});
async function sendMessage(){
  const id=selected;if(!id||sendingTasks.has(id))return;
  drafts.edit(id,$('message').value);
  const attempt=drafts.prepare(id,()=>crypto.randomUUID());
  sendingTasks.add(id);composerState();notice(null);
  try{
    await api(`/tasks/${id}/messages`,attempt);
    drafts.acknowledge(id,attempt.requestID);
    if(selected===id)$('message').value=drafts.get(id).text;
  }catch(error){notice(error);}
  finally{sendingTasks.delete(id);composerState();await refresh();}
}
$('message-form').onsubmit=e=>{e.preventDefault();void sendMessage().catch(notice);};
$('message').oninput=()=>{if(selected)drafts.edit(selected,$('message').value);composerState();};
$('retry-message').onclick=()=>{void sendMessage().catch(notice);};
$('retry-sync').onclick=()=>{notice(null);void refresh();};
$('copy-task-link').onclick=async()=>{
  if(!selected)return;
  const url=taskURL(publicOrigin||location.origin,selected);$('share-link').value=url;
  try{await navigator.clipboard.writeText(url);$('link-feedback').textContent='작업 링크를 복사했습니다.';}
  catch{$('link-feedback').textContent='작업 정보에서 링크를 선택해 복사하세요.';document.querySelector('.task-body').classList.remove('hide-inspector');$('inspector').classList.add('open');$('share-link').focus();$('share-link').select();}
};
$('message').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();$('message-form').requestSubmit();}};
document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='n'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!document.querySelector('dialog[open]')&&authenticated){e.preventDefault();dialog('task-dialog');}});
$('stop').onclick=()=>action($('stop'),()=>api(`/tasks/${selected}/stop`,{}));$('resume').onclick=()=>action($('resume'),()=>api(`/tasks/${selected}/resume`,{}));
async function changes(){const id=selected,c=await api(`/tasks/${id}/changes`);if(id!==selected)return;$('change-status').textContent=c.status||'변경된 파일이 없습니다.';$('change-text').replaceChildren(...(c.diff?c.diff.split('\n'):['아직 표시할 코드 차이가 없습니다.']).map(line=>el('div',line,`diff-line ${line.startsWith('+')?'added':line.startsWith('-')?'removed':line.startsWith('@@')?'hunk':''}`)));tab(true);}
$('changes').onclick=()=>action($('changes'),changes);$('refresh-changes').onclick=()=>action($('refresh-changes'),changes);$('chat-tab').onclick=()=>tab(false);
$('logout').onclick=()=>action($('logout'),async()=>{await api('/logout',{});authenticated=false;requestGeneration++;$('login').hidden=false;$('app').hidden=true;document.querySelectorAll('dialog[open]').forEach(d=>d.close());});
window.addEventListener('online',()=>{void refresh();});
window.addEventListener('offline',()=>{syncStatus(false);composerState();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
setInterval(()=>{if(!document.hidden)void refresh();},2000);
void open().catch(error=>{if(error.status!==401)$('login-error').textContent=error.message;});

}
if (typeof document!=='undefined') boot();
