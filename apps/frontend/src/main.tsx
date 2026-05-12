// Entry point.
// M1.1 boots a minimal React tree.
// M1.7 wires TanStack Router, QueryClient, error boundary, real route tree.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found in index.html');

createRoot(root).render(
  <StrictMode>
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-4xl font-bold text-amber-400">TWW3 Tournament Platform</h1>
      <p className="mt-2 text-stone-400">M1.1 skeleton up. Routes land in M1.7.</p>
    </main>
  </StrictMode>,
);
