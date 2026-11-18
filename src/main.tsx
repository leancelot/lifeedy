import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/Common/ErrorBoundary.tsx';
import { installGlobalErrorHandlers } from './services/errorJournalService.ts';
import './index.css';

installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
