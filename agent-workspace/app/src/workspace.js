import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { repository, createWorktree, changes } from './git.js';

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function text(value, name, max = 20000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError(`${name}: 1~${max}자 이내로 입력하세요.`);
  return value.trim();
}
export class Workspace {
  constructor(store, runtime, dataDirectory) {
    this.store = store; this.runtime = runtime; this.dataDirectory = dataDirectory;
    this.locks = new Map(); this.closed = false;
  }
  async locked(key, action) {
    const previous = this.locks.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.locks.set(key, next);
    try { return await next; }
    finally { if (this.locks.get(key) === next) this.locks.delete(key); }
  }
  get data() { return this.store.data; }
  task(id) {
    const task = this.data.tasks.find(t => t.id === id);
    if (!task) throw new InputError('작업을 찾을 수 없습니다.', 404);
    return task;
  }
  async addProject(input) {
    let directory;
    try { directory = await repository(text(input.directory, '저장소 경로', 4096)); }
    catch (error) { throw new InputError(error.message); }
    const existing = this.data.projects.find(p => p.directory === directory);
    if (existing) return existing;
    const project = { id: randomUUID(), name: basename(directory), directory };
    this.data.projects.push(project); this.store.save();
    return project;
  }
  async addTemplate(input) {
    const catalog = await this.runtime.catalog();
    const providerID = text(input.model?.providerID, '공급자', 200);
    const modelID = text(input.model?.modelID, '모델', 200);
    if (!catalog.some(p => p.id === providerID && p.models.some(m => m.id === modelID))) {
      throw new InputError('현재 연결된 모델을 선택하세요.');
    }
    const template = {
      id: randomUUID(), version: 1, name: text(input.name, '템플릿 이름', 100),
      model: { providerID, modelID }, prompt: text(input.prompt, '지침'),
      memory: typeof input.memory === 'string' ? input.memory.trim() : '',
      permissionProfile: 'review-shell-v1', createdAt: Date.now(),
    };
    if (template.memory.length > 20000) throw new InputError('메모리는 20,000자 이내로 입력하세요.');
    this.data.templates.push(template); this.store.save();
    return template;
  }
  async createTask(input) {
    return this.locked('create-task', async () => {
      const project = this.data.projects.find(p => p.id === input.projectID);
      const template = this.data.templates.find(t => t.id === input.templateID);
      if (!project || !template) throw new InputError('프로젝트와 템플릿을 선택하세요.');
      const title = text(input.title, '작업 이름', 160);
      const id = randomUUID();
      const tree = await createWorktree(project, this.dataDirectory, id);
      const task = {
        id, projectID: project.id, title, ...tree, template: structuredClone(template),
        createdAt: Date.now(), sessionID: null, queue: [], current: null,
        status: 'creating', paused: false, messages: [], permissions: [], questions: [],
        error: null, runtimeAvailable: false,
      };
      this.data.tasks.push(task); this.store.save();
      try {
        const session = await this.runtime.create(task.directory, title);
        task.sessionID = session.id; task.status = 'idle'; task.runtimeAvailable = true;
      } catch (error) {
        task.status = 'setup_failed'; task.error = error.message;
        // Retain the worktree and record. Never destroy user data on a failed setup.
      }
      this.store.save(); return task;
    });
  }
  async enqueue(id, input) {
    return this.locked(id, async () => {
      const task = this.task(id);
      if (!task.sessionID) throw new InputError('실행 세션이 준비되지 않았습니다.', 409);
      const requestID = text(input.requestID, '요청 ID', 100);
      const messageText = text(input.text, '메시지');
      const existing = task.queue.find(m => m.requestID === requestID);
      if (existing) {
        if (existing.text !== messageText) throw new InputError('같은 요청 ID에 다른 메시지를 사용할 수 없습니다.', 409);
        return existing;
      }
      const message = {
        id: randomUUID(), requestID, runtimeID: `msg${Date.now().toString(16)}${randomUUID().replaceAll('-', '')}`,
        text: messageText, status: 'queued', createdAt: Date.now(),
      };
      task.queue.push(message); this.store.save();
      return message;
    });
  }
  async tick(id) {
    return this.locked(id, async () => {
      const task = this.task(id);
      if (!task.sessionID || this.closed) return;
      const before = JSON.stringify(task);
      try {
        const snapshot = await this.runtime.snapshot(task);
        task.runtimeAvailable = true;
        task.messages = snapshot.messages;
        task.permissions = snapshot.permissions;
        task.questions = snapshot.questions;
        const current = task.queue.find(m => m.id === task.current);
        if (current) {
          const received = snapshot.messages.some(m => m.info.id === current.runtimeID);
          const replies = snapshot.messages.filter(m => m.info.role === 'assistant' && m.info.parentID === current.runtimeID);
          const final = replies.findLast(m => m.info.time?.completed && (m.info.error || (m.info.finish && m.info.finish !== 'tool-calls' && m.info.finish !== 'unknown')));
          if (snapshot.status === 'idle' && task.status === 'stopping') {
            current.status = 'cancelled'; task.current = null; task.status = 'stopped';
          } else if (snapshot.status === 'idle' && final) {
            current.status = final.info.error ? 'failed' : 'completed';
            task.status = final.info.error ? 'failed' : 'completed';
            task.error = final.info.error ? `${final.info.error.name || '실행 오류'}: ${final.info.error.data?.message || 'OpenCode 결과를 확인하세요.'}` : null;
            task.current = null;
            if (final.info.error) task.paused = true;
          } else if (received || snapshot.status !== 'idle') {
            current.status = 'delivered';
            if (task.status !== 'stopping') task.status = snapshot.permissions.length ? 'waiting_approval' : snapshot.questions.length ? 'waiting_input' : 'running';
            // An engine restart can leave a user message without a final answer.
            if (snapshot.status === 'idle' && Date.now() - current.sentAt > 15000) {
              task.status = 'interrupted'; task.paused = true;
              current.status = 'interrupted'; task.current = null;
              task.error = '실행이 끝나기 전에 중단되었습니다. 기록을 확인하고 새 지시를 보내세요.';
            }
          } else if (Date.now() - current.sentAt > 15000) {
            task.status = 'uncertain'; task.paused = true;
            current.status = 'uncertain';
            task.error = '메시지 전달 여부를 확인할 수 없습니다. 중복 실행을 막기 위해 자동 재전송하지 않습니다. 중단으로 상태를 확인하세요.';
          }
        }
        if (!task.current && !task.paused && snapshot.status === 'idle') {
          const next = task.queue.find(m => m.status === 'queued');
          if (next) {
            task.current = next.id; next.status = 'sending'; next.sentAt = Date.now();
            task.status = 'running'; task.error = null;
            this.store.save(); // Write before sending; ambiguous delivery is never retried automatically.
            try { await this.runtime.send(task, next); next.status = 'delivered'; }
            catch (error) {
              task.paused = true; task.error = error.message;
              if ([400, 401, 403, 404, 422].includes(error.status)) {
                next.status = 'failed'; task.status = 'failed'; task.current = null;
              } else { next.status = 'uncertain'; task.status = 'uncertain'; }
            }
          }
        }
      } catch (error) { task.runtimeAvailable = false; task.error = error.message; }
      if (JSON.stringify(task) !== before) this.store.save();
    });
  }
  async stop(id) {
    return this.locked(id, async () => {
      const task = this.task(id);
      if (!task.sessionID) throw new InputError('중단할 실행 세션이 없습니다.', 409);
      task.paused = true; task.status = 'stopping'; this.store.save();
      await this.runtime.abort(task);
      const snapshot = await this.runtime.snapshot(task);
      if (snapshot.status === 'idle') {
        const current = task.queue.find(m => m.id === task.current);
        if (current) current.status = 'cancelled';
        task.current = null; task.status = 'stopped';
        task.permissions = []; task.questions = []; task.messages = snapshot.messages;
      }
      this.store.save(); return task;
    });
  }
  async resume(id) {
    return this.locked(id, async () => {
      const task = this.task(id);
      if (task.current || task.status === 'stopping') throw new InputError('현재 실행의 종료 여부를 먼저 확인하세요.', 409);
      task.paused = false; task.status = 'idle'; task.error = null; this.store.save(); return task;
    });
  }
  async approve(id, requestID, reply) {
    return this.locked(id, async () => {
      if (!['once', 'reject'].includes(reply)) throw new InputError('한 번 승인 또는 거절을 선택하세요.');
      const task = this.task(id);
      const snapshot = await this.runtime.snapshot(task);
      if (!snapshot.permissions.some(p => p.id === requestID)) throw new InputError('이 작업의 대기 중 승인 요청이 아닙니다.', 409);
      await this.runtime.reply(task, requestID, reply);
      task.permissions = task.permissions.filter(p => p.id !== requestID); this.store.save();
      return { ok: true };
    });
  }
  async answer(id, requestID, answers) {
    return this.locked(id, async () => {
      const task = this.task(id);
      const snapshot = await this.runtime.snapshot(task);
      const question = snapshot.questions.find(q => q.id === requestID);
      if (!question) throw new InputError('이 작업의 대기 중 질문이 아닙니다.', 409);
      if (!Array.isArray(answers) || answers.length !== question.questions.length || answers.some(a => !Array.isArray(a) || a.some(v => typeof v !== 'string' || v.length > 2000))) throw new InputError('질문별 답을 입력하세요.');
      await this.runtime.answer(task, requestID, answers); return { ok: true };
    });
  }
  changes(id) { return changes(this.task(id).directory); }
  start() {
    let ticking = false;
    const poll = async () => {
      if (ticking || this.closed) return;
      ticking = true;
      try { await Promise.allSettled(this.data.tasks.map(t => this.tick(t.id))); }
      finally { ticking = false; }
    };
    this.timer = setInterval(poll, 1500); this.timer.unref(); void poll();
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    await Promise.allSettled([...this.locks.values()]);
    this.store.save();
  }
}
