import { loadWorkspace, saveWorkspace, type DocumentDraft, type Workspace } from './drafts';
import { exampleSource } from './example';
import newAppSource from './templates/new-app.lua?raw';

export type WorkspaceSnapshot = Workspace & { loaded: boolean; saved: boolean; storageError: string };

/** Synchronous document state shared by the editor and command callers. */
export class WorkspaceStore {
  private workspace: Workspace;
  private snapshot: WorkspaceSnapshot;
  private listeners = new Set<() => void>();
  private loadPromise: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private storageReady = false;
  private revision = 0;

  constructor() {
    const document = { id: crypto.randomUUID(), name: 'ui_demo.lua', source: exampleSource };
    this.workspace = { documents: [document], activeId: document.id };
    this.snapshot = { ...this.workspace, loaded: false, saved: false, storageError: '' };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<WorkspaceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        const stored = await loadWorkspace();
        this.storageReady = true;
        // Commands can edit before IndexedDB finishes loading. Their newer
        // synchronous state must never be replaced by the saved browser draft.
        if (stored && this.revision === 0) {
          this.workspace = stored;
          this.publish({ ...stored, loaded: true, saved: true, storageError: '' });
        } else {
          this.publish({ loaded: true });
          this.persist();
        }
      } catch (cause) {
        const message = '浏览器草稿存储不可用，请导出文件保存。';
        this.publish({ loaded: true, saved: false, storageError: message });
        throw new Error(message, { cause });
      }
    })();
    return this.loadPromise;
  }

  read(id?: string): DocumentDraft | null {
    const document = this.workspace.documents.find(item => item.id === (id ?? this.workspace.activeId));
    if (!document && id !== undefined) throw new Error('找不到指定的 Lua 草稿');
    return document ?? null;
  }

  openDocument(content: { name: string; source: string }): DocumentDraft {
    const existing = this.workspace.documents.find(item => item.name === content.name && item.source === content.source);
    if (existing) { this.selectDocument(existing.id); return existing; }
    const document = { id: crypto.randomUUID(), name: content.name, source: content.source };
    this.update({ documents: [...this.workspace.documents, document], activeId: document.id });
    return document;
  }

  createDocument(): DocumentDraft {
    let index = 1;
    while (this.workspace.documents.some(item => item.name === `untitled_${index}.lua`)) index++;
    return this.openDocument({ name: `untitled_${index}.lua`, source: newAppSource });
  }

  updateDocument(id: string, patch: { name?: string; source?: string }): DocumentDraft {
    const current = this.read(id)!;
    const document = { ...current, name: patch.name ?? current.name, source: patch.source ?? current.source };
    if (document.name === current.name && document.source === current.source) return current;
    this.update({ ...this.workspace, documents: this.workspace.documents.map(item => item.id === id ? document : item) });
    return document;
  }

  selectDocument(id: string) {
    if (this.workspace.activeId === id || !this.workspace.documents.some(item => item.id === id)) return;
    this.update({ ...this.workspace, activeId: id });
  }

  closeDocument(id: string) {
    const index = this.workspace.documents.findIndex(item => item.id === id);
    if (index < 0) return;
    const documents = this.workspace.documents.filter(item => item.id !== id);
    const activeId = this.workspace.activeId === id ? documents[Math.min(index, documents.length - 1)]?.id ?? '' : this.workspace.activeId;
    this.update({ documents, activeId });
  }

  private update(workspace: Workspace) {
    this.workspace = workspace;
    this.revision++;
    this.publish({ ...workspace, saved: false });
    if (this.storageReady) this.persist();
  }

  private persist() {
    const workspace = this.workspace;
    this.writes = this.writes.catch(() => {}).then(async () => {
      try {
        await saveWorkspace(workspace);
        this.publish({ saved: this.workspace === workspace, storageError: '' });
      } catch (cause) {
        const message = '草稿保存失败，请导出文件到电脑。';
        this.publish({ saved: false, storageError: message });
        throw new Error(message, { cause });
      }
    });
    // Automatic persistence reports through the snapshot; flush retains the
    // rejection so command callers cannot mistake a failed save for success.
    void this.writes.catch(() => {});
  }

  async flush(): Promise<void> {
    await this.load();
    let pending: Promise<void>;
    do { pending = this.writes; await pending; } while (pending !== this.writes);
  }
}
