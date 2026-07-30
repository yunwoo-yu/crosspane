import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LocaleProvider } from './hooks/useLocale';
import './app.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('crosspane: #root element not found');

createRoot(rootElement).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
