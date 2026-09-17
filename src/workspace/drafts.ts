export type Draft = { name: string; source: string; updatedAt: number };

export type DocumentDraft = { id: string; name: string; source: string };
export type Workspace = { documents: DocumentDraft[]; activeId: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ryzobee-link', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开草稿存储'));
  });
}

export async function loadDraft(): Promise<Draft | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('workspace').objectStore('workspace').get('draft');
      request.onsuccess = () => {
        const value: unknown = request.result;
        resolve(isDraft(value) ? value : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

export function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<Draft>;
  return typeof draft.name === 'string' && typeof draft.source === 'string'
    && typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt);
}

async function saveRecord(key: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('保存草稿被中断'));
    });
  } finally { database.close(); }
}

export function downloadLua(name: string, source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function loadWorkspace(): Promise<Workspace | null> {
  const database = await openDatabase();
  let value: unknown;
  try {
    value = await new Promise((resolve, reject) => {
      const request = database.transaction('workspace').objectStore('workspace').get('tabs');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
  if (value !== undefined) {
    const stored = value as Partial<Workspace> | null;
    if (!stored || !Array.isArray(stored.documents)
      || !stored.documents.every(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.source === 'string')
      || new Set(stored.documents.map(item => item.id)).size !== stored.documents.length
      || (stored.documents.length ? !stored.documents.some(item => item.id === stored.activeId) : stored.activeId !== '')) throw new Error('Invalid workspace');
    return stored as Workspace;
  }
  const legacy = await loadDraft();
  if (!legacy) return null;
  const document = { id: crypto.randomUUID(), name: legacy.name, source: legacy.source };
  return { documents: [document], activeId: document.id };
}

export const saveWorkspace = (workspace: Workspace) => saveRecord('tabs', workspace);
export const saveDraft = (draft: Draft) => saveRecord('draft', draft);
