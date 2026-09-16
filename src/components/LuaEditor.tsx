import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/lua/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { createLuaEditorTheme } from './luaEditorTheme';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
export type SourceError = { line: number; message: string; source: string };
const methods: Record<string, string[]> = {
  ui: ['mount(scene)', 'update(generation, patches)', 'poll()'],
  board: ['sleep_ms(20)', 'millis()', 'mark("name", value)'],
};
monaco.languages.registerCompletionItemProvider('lua', {
  triggerCharacters: ['.'],
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const owner = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1).match(/(\w+)\.$/)?.[1];
    const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
    return { suggestions: (methods[owner ?? ''] ?? []).map(text => ({
      label: text, insertText: text, range, kind: monaco.languages.CompletionItemKind.Function,
    })) };
  },
});

export default function LuaEditor({ source, onChange, error }: {
  source: string; onChange: (source: string) => void; error: SourceError | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onEdit = useRef(onChange); onEdit.current = onChange;
  useEffect(() => {
    monaco.editor.defineTheme('ryzobee-link', createLuaEditorTheme(getComputedStyle(document.documentElement)));
    const instance = monaco.editor.create(host.current!, {
      value: source, language: 'lua', theme: 'ryzobee-link', automaticLayout: true,
      minimap: { enabled: false }, fontSize: 16, lineHeight: 26, tabSize: 2,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(),
      padding: { top: 16, bottom: 20 }, scrollBeyondLastLine: false,
      ariaLabel: 'Lua 源码编辑器', fixedOverflowWidgets: true,
      bracketPairColorization: { enabled: false }, renderLineHighlight: 'none',
    });
    editor.current = instance;
    const change = instance.onDidChangeModelContent(() => onEdit.current(instance.getValue()));
    return () => { change.dispose(); const model = instance.getModel(); instance.dispose(); model?.dispose(); editor.current = null; };
  }, []);
  // Monaco owns keystrokes. React receives snapshots for persistence/execution,
  // but must never echo an older effect back over newer native input. App changes
  // this component's key only when a local/device file replaces the document.
  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    const current = error?.source === source ? error : null;
    const line = Math.min(model.getLineCount(), Math.max(1, current?.line ?? 1));
    monaco.editor.setModelMarkers(model, 'lua-runtime', current ? [{
      startLineNumber: line, endLineNumber: line, startColumn: 1,
      endColumn: model.getLineMaxColumn(line), message: current.message, severity: monaco.MarkerSeverity.Error,
    }] : []);
    if (current) editor.current?.revealLineInCenter(line);
  }, [source, error]);
  return <div ref={host} className="lua-editor" />;
}
