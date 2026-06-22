import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { ThemeProvider } from '@/components/ThemeProvider';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="ui-theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
);
