// Persist the exact request before sending. Retry is always an explicit user action.
export class PendingExperiment {
  constructor(storage) { this.storage = storage; }
  read() {
    const pending = JSON.parse(this.storage.getItem('workspace:experiment:pending') || 'null');
    if (pending && (typeof pending.requestID !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(pending.requestID)
        || typeof pending.prompt !== 'string' || typeof pending.model !== 'string')) throw new Error('저장된 실험 요청을 읽지 못했습니다. 이 탭의 저장 상태를 확인하세요.');
    return pending;
  }
  prepare(input, newID) {
    const previous = this.read();
    if (previous) return previous;
    const pending = { ...input, requestID: newID() };
    this.storage.setItem('workspace:experiment:pending', JSON.stringify(pending));
    return pending;
  }
  acknowledge(id) {
    if (this.read()?.requestID === id) this.storage.removeItem('workspace:experiment:pending');
  }
}

export function bootExperiments() {
  const $ = id => document.getElementById(id);
  const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const labels = { running: '실행 중', completed: '응답 완료', failed: '실패', interrupted: '중단·결과 미확인', pass: '통과', partial: '부분 충족', fail: '실패' };
  const selectedFromHash = () => /^#run=([a-zA-Z0-9-]{1,100})$/.exec(location.hash)?.[1] || null;
  let selected = selectedFromHash(), current, ready = false, polling = false, sending = false, available = false, evaluationAttempt;
  let pending;
  try { pending = new PendingExperiment(window.sessionStorage); pending.read(); }
  catch { pending = null; }
  function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
  async function api(path, input) {
    let response;
    try {
      response = await fetch(`/api${path}`, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(15000), ...(input === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }) });
    } catch { throw new Error('서버 연결을 확인하세요. 미확인 요청은 자동 재전송하지 않습니다.'); }
    if (response.status === 401) { ready = false; $('experiment-content').hidden = true; $('login-help').hidden = false; }
    let data;
    try { data = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 접수 여부를 확인하세요.'); }
    if (!response.ok) { const error = new Error(data.error || '요청을 완료하지 못했습니다.'); error.status = response.status; throw error; }
    return data;
  }
  function controls() {
    let previous;
    try { previous = pending?.read(); } catch { pending = null; }
    $('run').disabled = !ready || !available || !pending || !!previous || sending;
    $('retry').disabled = !ready || sending || !previous;
    $('pending').hidden = !previous;
    if (!pending) notice('이 탭에 요청 ID를 저장할 수 없어 실험 실행을 막았습니다. 브라우저 저장 공간을 확인하세요.');
  }
  async function catalog() {
    available = false;
    try {
      const data = await api('/experiments/catalog'), previous = $('model').value;
      const models = data.models.filter(model => !model.remote);
      $('model').replaceChildren(...models.map(model => { const option = el('option', `${model.name} · ${model.details?.parameter_size || '?'} · ${model.details?.quantization_level || '?'}`); option.value = model.name; return option; }));
      if (models.some(model => model.name === previous)) $('model').value = previous;
      available = models.length > 0;
      $('connection').textContent = `Ollama ${data.version} · 설치된 로컬 모델 ${models.length}개`;
      if (!available) notice('설치된 로컬 모델이 없습니다. 맥미니에서 모델을 준비한 후 새로고침하세요.');
    } catch (error) { $('connection').textContent = 'Ollama 연결 확인 필요 · 저장된 실험 기록은 조회할 수 있습니다.'; notice(error.message); }
    controls();
  }
  function select(id) { selected = id; current = null; evaluationAttempt = null; $('notes').value = ''; history.replaceState(null, '', `#run=${id}`); void refresh().catch(error => notice(error.message)); }
  function detail(run) {
    current = run; $('detail').hidden = false;
    $('detail-title').textContent = run.input.model;
    $('detail-status').textContent = `${labels[run.status]} · ${new Date(run.createdAt).toLocaleString('ko-KR')}`;
    $('detail-error').hidden = !run.error; $('detail-error').textContent = run.error?.message || '';
    $('detail-prompt').textContent = run.input.prompt;
    $('response').textContent = run.response?.text || (run.status === 'running' ? '응답을 기다립니다. 페이지를 닫아도 서버에서 계속 실행합니다.' : '저장된 응답이 없습니다.');
    $('thinking-panel').hidden = !run.response?.thinking; $('thinking').textContent = run.response?.thinking || '';
    $('settings').textContent = JSON.stringify({ input: run.input, execution: run.execution, modelSnapshot: run.modelSnapshot, metrics: run.response?.metrics }, null, 2);
    const metrics = run.response?.metrics || {};
    const rows = [['실험 ID', run.id], ['소요 시간', run.finishedAt ? `${((run.finishedAt - run.createdAt) / 1000).toFixed(2)}초 (모델 확인 포함)` : '진행 중'],
      ['종료 이유', run.response?.doneReason || '—'], ['생성 토큰', metrics.eval_count ?? '—'],
      ['생성 속도', metrics.eval_duration > 0 && metrics.eval_count !== undefined ? `${(metrics.eval_count / metrics.eval_duration * 1e9).toFixed(1)} token/s` : '—'],
      ['모델 digest', run.modelSnapshot?.digest || '확인 전']];
    $('metadata').replaceChildren(...rows.flatMap(([key, value]) => [el('dt', key), el('dd', String(value))]));
    $('evaluations').replaceChildren(...run.evaluations.map(item => { const box = el('div'); box.className = 'experiment-evaluation'; box.append(el('strong', `${labels[item.verdict]} · ${new Date(item.createdAt).toLocaleString('ko-KR')}`), el('p', item.notes)); return box; }));
    if (!run.evaluations.length) $('evaluations').append(el('p', '아직 평가하지 않았습니다. 응답 완료와 품질 평가는 별개입니다.'));
    $('cancel').hidden = run.status !== 'running'; $('save-evaluation').disabled = run.status === 'running';
  }
  async function refresh() {
    if (!ready || polling) return;
    polling = true;
    try {
      const data = await api('/experiments');
      if (!ready) return;
      $('count').textContent = `${data.runs.length}개`;
      const signature = JSON.stringify([selected, data.runs]);
      if ($('history').dataset.signature !== signature) {
        $('history').replaceChildren(...data.runs.map(run => { const button = el('button'); button.className = 'experiment-history-item'; button.setAttribute('aria-current', String(selected === run.id)); button.append(el('strong', `${run.model} · ${labels[run.status]}`), el('span', run.prompt), el('small', `${new Date(run.createdAt).toLocaleString('ko-KR')} · 평가 ${run.evaluation ? labels[run.evaluation.verdict] : '대기'}`)); button.onclick = () => select(run.id); return button; }));
        if (!data.runs.length) $('history').append(el('p', '첫 실험을 실행하면 여기에 기록됩니다.'));
        $('history').dataset.signature = signature;
      }
      const previous = pending?.read();
      if (previous && data.runs.some(run => run.id === previous.requestID)) { pending.acknowledge(previous.requestID); if (!selected) { selected = previous.requestID; history.replaceState(null, '', `#run=${selected}`); } }
      if (selected) {
        const id = selected, run = await api(`/experiments/${id}`);
        if (selected === id && ready) detail(run);
      }
      controls();
    } finally { polling = false; }
  }
  function input() {
    return { model: $('model').value, system: $('system').value, prompt: $('prompt').value,
      confirm: $('confirm').checked, options: Object.fromEntries(['temperature', 'top_p', 'seed', 'num_ctx', 'num_predict'].map(key => [key, Number($(key).value)])) };
  }
  async function send(retry = false) {
    if (sending || !pending) return;
    sending = true; notice();
    try {
      const request = retry ? pending.read() : pending.prepare(input(), () => crypto.randomUUID());
      if (!request) return;
      controls();
      const run = await api('/experiments', request);
      pending.acknowledge(request.requestID); select(run.id); $('confirm').checked = false;
    } catch (error) {
      if ([400, 413, 415].includes(error.status)) { const request = pending.read(); if (request) pending.acknowledge(request.requestID); }
      notice(error.message);
    }
    finally { sending = false; controls(); await refresh().catch(error => notice(error.message)); }
  }
  $('run-form').onsubmit = event => { event.preventDefault(); void send(); };
  $('retry').onclick = () => { void send(true); };
  $('refresh').onclick = async () => { notice(); await catalog(); await refresh().catch(error => notice(error.message)); };
  $('cancel').onclick = async () => { if (!current) return; try { await api(`/experiments/${current.id}/cancel`, {}); await refresh(); } catch (error) { notice(error.message); } };
  $('reuse').onclick = () => {
    if (!current) return;
    const data = current.input;
    if (![...$('model').options].some(option => option.value === data.model)) { notice('이 기록의 모델이 현재 설치 목록에 없습니다. 모델 목록을 확인하세요.'); return; }
    $('model').value = data.model; $('system').value = data.system; $('prompt').value = data.prompt;
    for (const [key, value] of Object.entries(data.options)) $(key).value = value;
    $('confirm').checked = false; $('prompt').focus();
  };
  $('export').onclick = () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }));
    const link = el('a'); link.href = url; link.download = `ollama-${current.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('evaluation-form').onsubmit = async event => {
    event.preventDefault(); if (!current) return;
    const id = current.id, data = { verdict: $('verdict').value, notes: $('notes').value };
    if (!evaluationAttempt || evaluationAttempt.id !== id || JSON.stringify(evaluationAttempt.data) !== JSON.stringify(data)) evaluationAttempt = { id, data, requestID: crypto.randomUUID() };
    $('save-evaluation').disabled = true;
    try { await api(`/experiments/${id}/evaluations`, { ...data, requestID: evaluationAttempt.requestID }); if (selected === id) $('notes').value = ''; evaluationAttempt = null; await refresh(); }
    catch (error) { notice(error.message); }
    finally { $('save-evaluation').disabled = current?.status === 'running'; }
  };
  window.addEventListener('hashchange', () => { selected = selectedFromHash(); current = null; $('detail').hidden = true; void refresh().catch(error => notice(error.message)); });
  setInterval(() => { if (!document.hidden) void refresh().catch(error => notice(error.message)); }, 2000);
  void (async () => {
    try {
      const system = await api('/system');
      if (!system.features?.ollamaExperiments) throw new Error('M3 서버 업데이트가 필요합니다. 운영 서버를 재시작한 뒤 다시 열어 주세요.');
      ready = true; $('experiment-content').hidden = false; await catalog(); await refresh();
    } catch (error) { notice(error.message); }
  })();
}
if (typeof document !== 'undefined') bootExperiments();
