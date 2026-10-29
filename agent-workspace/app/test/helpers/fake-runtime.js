// Deterministic runtime double. Tests using this do not contact OpenCode or a model.
export class FakeRuntime {
  constructor() { this.sessions = new Map(); this.sent = []; this.replies = []; this.answers = []; this.completed = 0; }
  async health() { return { healthy: true, version: 'fake-test-runtime' }; }
  async catalog() { return [{ id: 'deepseek', name: 'Test provider', models: [{ id: 'test', name: 'Test model' }] }]; }
  async create() {
    const id = `ses${this.sessions.size}`;
    this.sessions.set(id, { messages: [], status: 'idle', permissions: [], questions: [] });
    return { id };
  }
  async snapshot(task) { return structuredClone(this.sessions.get(task.sessionID)); }
  async send(task, message) {
    this.sent.push(message.runtimeID);
    const session = this.sessions.get(task.sessionID);
    session.status = 'busy';
    session.messages.push({ info: { id: message.runtimeID, role: 'user' }, parts: [{ type: 'text', text: message.text }] });
  }
  finish(task) {
    const session = this.sessions.get(task.sessionID);
    session.status = 'idle';
    const parentID = task.queue.find(message => message.id === task.current).runtimeID;
    session.messages.push({
      info: { id: `msgreply${++this.completed}`, role: 'assistant', parentID, time: { completed: Date.now() }, finish: 'stop' },
      parts: [{ type: 'text', text: 'done' }],
    });
  }
  async abort(task) {
    const session = this.sessions.get(task.sessionID);
    session.status = 'idle'; session.permissions = []; session.questions = [];
    return true;
  }
  async reply(task, id, reply) {
    this.replies.push({ task: task.id, id, reply });
    const session = this.sessions.get(task.sessionID);
    session.permissions = session.permissions.filter(request => request.id !== id);
  }
  async answer(task, id, answers) {
    this.answers.push({ task: task.id, id, answers });
    const session = this.sessions.get(task.sessionID);
    session.questions = session.questions.filter(request => request.id !== id);
  }
}
