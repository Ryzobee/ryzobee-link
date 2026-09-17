import { useEffect, useRef, type RefObject } from 'react';

export const shortcuts = {
  open: { label: '打开本地文件', key: 'o', shift: false },
  save: { label: '保存到电脑', key: 's', shift: false },
  simulate: { label: '运行 / 停止模拟器', key: 'Enter', shift: false },
  send: { label: '发送到设备', key: 'Enter', shift: true },
  help: { label: '查看快捷键', key: 'F1', shift: false },
} as const;
export type ShortcutCommand = keyof typeof shortcuts;
const apple = /Mac|iPhone|iPad/.test(navigator.platform);

export function shortcutLabel(command: ShortcutCommand) {
  const binding = shortcuts[command];
  if (command === 'help') return binding.key;
  return `${apple ? '⌘' : 'Ctrl'}+${binding.shift ? 'Shift+' : ''}${binding.key.length === 1 ? binding.key.toUpperCase() : binding.key}`;
}

export function shortcutAria(command: ShortcutCommand) {
  const binding = shortcuts[command];
  if (command === 'help') return binding.key;
  return ['Control', 'Meta'].map(modifier => `${modifier}+${binding.shift ? 'Shift+' : ''}${binding.key}`).join(' ');
}

// Buttons remain the single source of action/availability; keyboard activation
// shares their live source snapshot, disabled state and async re-entry guards.
export function useKeyboardShortcuts(targets: Record<ShortcutCommand, RefObject<HTMLButtonElement | null>>) {
  const current = useRef(targets); current.current = targets;
  useEffect(() => {
    let composing = false;
    const startComposition = () => { composing = true; };
    const endComposition = () => { composing = false; };
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || composing || event.isComposing || event.keyCode === 229 || event.altKey || event.getModifierState('AltGraph')) return;
      const command = (Object.keys(shortcuts) as ShortcutCommand[]).find(id => {
        const binding = shortcuts[id];
        const modifier = id === 'help' ? !event.ctrlKey && !event.metaKey : event.ctrlKey !== event.metaKey;
        return modifier && event.shiftKey === binding.shift && event.key.toLowerCase() === binding.key.toLowerCase();
      });
      if (!command) return;
      // Claim the key even while disabled: Monaco otherwise inserts a line for
      // Ctrl/Command+Enter, or a focused dialog button could confirm a write.
      event.preventDefault(); event.stopPropagation();
      if (event.repeat || document.querySelector('dialog[open]')) return;
      const button = current.current[command].current;
      if (button?.isConnected && !button.disabled) button.click();
    };
    window.addEventListener('keydown', handle, true);
    window.addEventListener('compositionstart', startComposition, true);
    window.addEventListener('compositionend', endComposition, true);
    window.addEventListener('blur', endComposition);
    return () => {
      window.removeEventListener('keydown', handle, true);
      window.removeEventListener('compositionstart', startComposition, true);
      window.removeEventListener('compositionend', endComposition, true);
      window.removeEventListener('blur', endComposition);
    };
  }, []);
}
