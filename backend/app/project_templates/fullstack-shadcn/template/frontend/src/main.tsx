import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { loadRuntimeConfig } from './lib/config.ts';

async function initializeApp() {
  try {
    await loadRuntimeConfig();
    console.log('Runtime configuration loaded successfully');
  } catch (error) {
    console.warn('Failed to load runtime configuration, using defaults:', error);
  }

  createRoot(document.getElementById('root')!).render(<App />);
}

initializeApp();
