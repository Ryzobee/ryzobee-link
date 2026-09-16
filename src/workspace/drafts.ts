export type Draft = { name: string; source: string; updatedAt: number };

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

export async function saveDraft(draft: Draft): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(draft, 'draft');
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
