import { useEffect, useRef, useState } from 'react';
import { loadWorkspace, saveWorkspace, type Workspace, type DocumentDraft } from './drafts';
import { exampleSource } from './example';
import newAppSource from './templates/new-app.lua?raw';

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    const document = { id: crypto.randomUUID(), name: 'ui_demo.lua', source: exampleSource };
    return { documents: [document], activeId: document.id };
  });
  const [loaded, setLoaded] = useState(false);
  const [persisted, setPersisted] = useState<Workspace | null>(null);
  const [storageError, setStorageError] = useState('');
  const queue = useRef(Promise.resolve());
  const storageReady = useRef(false);
  const draft = workspace.documents.find(item => item.id === workspace.activeId) ?? { id: '', name: '', source: '' };
  useEffect(() => {
    let mounted = true;
    void loadWorkspace().then(stored => {
      storageReady.current = true;
      if (mounted && stored) { setWorkspace(stored); setPersisted(stored); }
    }).catch(() => { if (mounted) setStorageError('浏览器草稿存储不可用，请导出文件保存。'); })
      .finally(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!loaded || !storageReady.current) return;
    let current = true;
    queue.current = queue.current.catch(() => {}).then(() => saveWorkspace(workspace));
    void queue.current.then(() => {
      if (current) { setPersisted(workspace); setStorageError(''); }
    }).catch(() => { if (current) setStorageError('草稿保存失败，请导出文件到电脑。'); });
    return () => { current = false; };
  }, [workspace, loaded]);
  useEffect(() => {
    if (!loaded) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [loaded]);
  function updateDraft(update: (current: DocumentDraft) => { name: string; source: string }) {
    const id = draft.id;
    setWorkspace(current => ({ ...current, documents: current.documents.map(item => item.id === id ? { ...item, ...update(item) } : item) }));
  }
  function openDocument(content: { name: string; source: string }) {
    const id = crypto.randomUUID();
    setWorkspace(current => {
      // Identical imports focus the existing tab; differing content never overwrites edits.
      const existing = current.documents.find(item => item.name === content.name && item.source === content.source);
      return existing ? { ...current, activeId: existing.id }
        : { documents: [...current.documents, { id, name: content.name, source: content.source }], activeId: id };
    });
  }
  function createDocument() {
    const id = crypto.randomUUID();
    setWorkspace(current => {
      let index = 1;
      while (current.documents.some(item => item.name === 'untitled_' + index + '.lua')) index++;
      return { documents: [...current.documents, { id, name: 'untitled_' + index + '.lua', source: newAppSource }], activeId: id };
    });
  }
  function closeDocument(id: string) {
    setWorkspace(current => {
      const index = current.documents.findIndex(item => item.id === id);
      if (index < 0) return current;
      const documents = current.documents.filter(item => item.id !== id);
      const activeId = current.activeId === id ? documents[Math.min(index, documents.length - 1)]?.id ?? '' : current.activeId;
      return { documents, activeId };
    });
  }
  return {
    documents: workspace.documents, draft, loaded, saved: workspace === persisted, storageError,
    updateDraft, openDocument, createDocument, closeDocument,
    selectDocument: (id: string) => setWorkspace(current => current.documents.some(item => item.id === id) ? { ...current, activeId: id } : current),
  };
}
