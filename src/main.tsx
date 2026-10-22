import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// After a new deploy, an open tab can ask for code files that were renamed. Reload once to pick up the new version.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'iwt-reloaded-for-update';
  let last = 0;
  try { last = Number(sessionStorage.getItem(key) || 0); } catch { /* storage blocked */ }
  if (Date.now() - last < 30_000) return; // already tried; let the error show instead of looping
  try { sessionStorage.setItem(key, String(Date.now())); } catch { /* storage blocked */ }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
