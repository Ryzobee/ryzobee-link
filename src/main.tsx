import { createRoot } from 'react-dom/client';
import App from './App';
import './theme.css';
import './style.css';
import '@vscode/codicons/dist/codicon.css';

createRoot(document.getElementById('root')!).render(<App />);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(error => console.warn('离线缓存未启用', error));
  });
}
