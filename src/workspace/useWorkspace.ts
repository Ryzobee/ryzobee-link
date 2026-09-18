import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DocumentDraft } from './drafts';
import { WorkspaceStore } from './store';

export function useWorkspace(providedStore?: WorkspaceStore) {
  const [ownedStore] = useState(() => new WorkspaceStore());
  const store = providedStore ?? ownedStore;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const draft = snapshot.documents.find(item => item.id === snapshot.activeId) ?? { id: '', name: '', source: '' };
  useEffect(() => { void store.load().catch(() => {}); }, [store]);
  useEffect(() => {
    if (!snapshot.loaded) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [snapshot.loaded]);
  function updateDraft(update: (current: DocumentDraft) => { name: string; source: string }) {
    const current = store.getSnapshot().documents.find(item => item.id === draft.id);
    if (current) store.updateDocument(current.id, update(current));
  }
  return {
    ...snapshot, draft, store, updateDraft,
    openDocument: (content: { name: string; source: string }) => store.openDocument(content),
    createDocument: () => store.createDocument(),
    closeDocument: (id: string) => store.closeDocument(id),
    selectDocument: (id: string) => store.selectDocument(id),
  };
}
