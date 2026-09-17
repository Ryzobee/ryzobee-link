import Modal from './Modal';
import { shortcuts, shortcutLabel, type ShortcutCommand } from '../workspace/shortcuts';

export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return <Modal title="快捷键" onClose={onClose}>
    <dl className="shortcut-list">
      {(Object.keys(shortcuts) as ShortcutCommand[]).map(command => <div key={command}>
        <dt>{shortcuts[command].label}</dt><dd><kbd>{shortcutLabel(command)}</kbd></dd>
      </div>)}
      <div><dt>切换文件标签¹</dt><dd><kbd>← / →</kbd></dd></div>
      <div><dt>关闭弹窗</dt><dd><kbd>Esc</kbd></dd></div>
    </dl>
    <p className="shortcut-note">¹ 聚焦文件标签后使用。发送仍需确认。</p>
  </Modal>;
}
