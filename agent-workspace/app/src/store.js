import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// Schema is owned by the workspace, not by a particular runtime.
export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, 'workspace.json');
    try { this.data = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = { version: 1, projects: [], tasks: [], templates: [] };
    }
    if (this.data.version !== 1 || !['projects', 'tasks', 'templates'].every(k => Array.isArray(this.data[k]))) {
      throw new Error('Unsupported or damaged workspace data. Restore a backup before starting.');
    }
  }
  save() {
    const temp = `${this.file}.tmp`;
    const fd = openSync(temp, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(this.data, null, 2)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temp, this.file);
    chmodSync(this.file, 0o600);
  }
}
