import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { UpdatePrompt } from './UpdatePrompt';
import './index.css';

// Captura errores fatales y los muestra en pantalla en vez de pantalla blanca
window.addEventListener('error', (e) => {
  const root = document.getElementById('root');
  if (root && root.childElementCount === 0) {
    root.innerHTML = `<div style="padding:24px;font-family:monospace;font-size:13px;background:#fff;color:#b91c1c;white-space:pre-wrap;word-break:break-all">
<strong>ERROR AL INICIAR LA APP:</strong>

${e.message}

${e.error?.stack ?? ''}

<em>Captura este texto y compártelo para diagnosticar el problema.</em>
</div>`;
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[Unhandled Promise]', e.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <UpdatePrompt />
  </React.StrictMode>,
);