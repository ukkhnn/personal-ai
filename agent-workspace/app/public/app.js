const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(className)n.className=className; return n; };
const icon = name => { const n=document.createElementNS('http://www.w3.org/2000/svg','svg'), u=document.createElementNS(n.namespaceURI,'use'); u.setAttribute('href',`#i-${name}`); n.append(u); return n; };
const labels={idle:'준비됨',creating:'준비 중',setup_failed:'설정 실패',running:'실행 중',waiting_approval:'승인 대기',waiting_input:'답변 대기',completed:'완료',failed:'실행 실패',stopping:'중단 확인 중',stopped:'중단됨',uncertain:'전달 확인 필요',interrupted:'실행 끊김',queued:'대기 중',sending:'전달 중',delivered:'전달됨',cancelled:'중단됨'};
let state={projects:[],templates:[],tasks:[]}, selected=sessionStorage.getItem('task'), projectFilter='', polling=false, authenticated=false, messageAttempt, messageSignature='', approvalSignature='', questionSignature='';
const drafts=new Map();
async function api(path,input){
  const r=await fetch(`/api${path}`,input===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}), data=await r.json();
  if(r.status===401){authenticated=false;$('login').hidden=false;$('app').hidden=true;}
  if(!r.ok)throw new Error(data.error||'요청 실패'); return data;
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
function selectTask(id){
  if(selected)drafts.set(selected,$('message').value);
  selected=id;sessionStorage.setItem('task',id||'');$('message').value=drafts.get(id)||'';
  messageSignature=approvalSignature=questionSignature='';sidebar(false);tab(false);renderState();void refresh();
}
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
  const aps=JSON.stringify(task.permissions);
  if(approvalSignature!==aps){approvalSignature=aps;$('approvals').replaceChildren(...task.permissions.map(r=>{const box=el('div',undefined,'request');box.append(el('h3','실행 승인이 필요합니다'),el('pre',`${r.permission}\n${r.patterns.join('\n')}`));for(const [reply,label]of [['once','이번 실행 승인'],['reject','거절']]){const b=el('button',label,reply==='once'?'primary':'');b.onclick=()=>action(b,()=>api(`/tasks/${task.id}/permissions`,{id:r.id,reply}));box.append(b);}return box;}));}
  const qs=JSON.stringify(task.questions);
  if(questionSignature!==qs){questionSignature=qs;$('questions').replaceChildren(...task.questions.map(r=>{const f=el('form',undefined,'request'),fields=[];for(const q of r.questions){const label=el('label',q.question),input=el('input');input.required=true;if(q.options?.length)label.append(el('small',q.options.map(o=>o.label).join(' / ')));label.append(input);f.append(label);fields.push(input);}const b=el('button','답변 전달','primary');b.type='submit';f.append(b);f.onsubmit=e=>{e.preventDefault();void action(b,()=>api(`/tasks/${task.id}/questions`,{id:r.id,answers:fields.map(i=>[i.value])}));};return f;}));}
}
async function refresh(){if(!authenticated||polling)return;polling=true;try{state=await api('/state');if(selected&&!state.tasks.some(t=>t.id===selected))selected=null;renderState();if(selected){const id=selected,task=await api(`/tasks/${id}`);if(id===selected)renderTask(task);}}catch(e){notice(e);}finally{polling=false;}}
async function action(button,operation){button.disabled=true;notice(null);try{await operation();await refresh();}catch(e){notice(e);}finally{button.disabled=false;}}
function form(id,operation){$(id).onsubmit=e=>{e.preventDefault();void action($(id).querySelector('button[type=submit]'),operation);};}
async function open(){await api('/state');const system=await api('/system');$('server-location').textContent=system.access==='tailscale'?'맥미니 · 원격 연결':'맥미니 · 로컬 연결';$('server-location').title=system.publicOrigin||'원격 접속 설정 전';authenticated=true;$('login').hidden=true;$('app').hidden=false;await loadRuntime();await refresh();}
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
form('message-form',async()=>{if(!selected)return;const value=$('message').value,id=selected;if(!messageAttempt||messageAttempt.text!==value||messageAttempt.task!==id)messageAttempt={text:value,requestID:crypto.randomUUID(),task:id};await api(`/tasks/${id}/messages`,messageAttempt);drafts.delete(id);if(selected===id)$('message').value='';messageAttempt=null;});
$('message').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();$('message-form').requestSubmit();}};
document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='n'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)&&!document.querySelector('dialog[open]')&&authenticated){e.preventDefault();dialog('task-dialog');}});
$('stop').onclick=()=>action($('stop'),()=>api(`/tasks/${selected}/stop`,{}));$('resume').onclick=()=>action($('resume'),()=>api(`/tasks/${selected}/resume`,{}));
async function changes(){const id=selected,c=await api(`/tasks/${id}/changes`);if(id!==selected)return;$('change-status').textContent=c.status||'변경된 파일이 없습니다.';$('change-text').replaceChildren(...(c.diff?c.diff.split('\n'):['아직 표시할 코드 차이가 없습니다.']).map(line=>el('div',line,`diff-line ${line.startsWith('+')?'added':line.startsWith('-')?'removed':line.startsWith('@@')?'hunk':''}`)));tab(true);}
$('changes').onclick=()=>action($('changes'),changes);$('refresh-changes').onclick=()=>action($('refresh-changes'),changes);$('chat-tab').onclick=()=>tab(false);
$('logout').onclick=()=>action($('logout'),async()=>{await api('/logout',{});authenticated=false;$('login').hidden=false;$('app').hidden=true;});
setInterval(refresh,2000);void open().catch(e=>{if(authenticated)notice(e);});
