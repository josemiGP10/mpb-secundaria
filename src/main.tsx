import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { UpdatePrompt } from './UpdatePrompt';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <UpdatePrompt />
  </React.StrictMode>,
);
