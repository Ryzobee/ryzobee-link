import { useEffect, useRef, type ReactNode } from 'react';
import Icon from './Icon';

export default function Modal({ title, onClose, children, busy = false }: {
  title: string; onClose: () => void; children: ReactNode; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!; node.showModal();
    return () => node.close();
  }, []);
  return <dialog ref={dialog} className="modal" aria-label={title}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}
