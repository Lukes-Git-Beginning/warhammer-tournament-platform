import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';

import '@fontsource-variable/cinzel';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/im-fell-english';
import '@fontsource/cinzel-decorative/400.css';
import '@fontsource/cinzel-decorative/700.css';
import './app.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
