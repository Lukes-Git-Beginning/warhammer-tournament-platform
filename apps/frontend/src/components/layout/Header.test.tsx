import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  useAuthQuery: vi.fn(() => ({ data: null })),
  useLogout: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/components/auth/DiscordLoginButton', () => ({
  DiscordLoginButton: () => createElement('button', null, 'Login mit Discord'),
}));

// TanStack Router Link — einfache Anchor-Ersetzung
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [key: string]: unknown }) =>
    createElement('a', { href: to, ...rest }, children),
}));

import { Header } from './Header';

// ---------------------------------------------------------------------------
// Test-Hilfsfunktionen
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function renderHeader() {
  act(() => {
    root.render(createElement(Header));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Header', () => {
  it('rendert ohne Fehler (Smoke)', () => {
    renderHeader();
    expect(container.querySelector('header')).toBeTruthy();
  });

  it('zeigt Rizzotto Logo-Link zum Home', () => {
    renderHeader();
    const logo = container.querySelector('a[href="/"]');
    expect(logo).toBeTruthy();
    expect(logo?.getAttribute('aria-label')).toContain('Rizzotto');
  });

  it('Hamburger-Button ist initial vorhanden', () => {
    renderHeader();
    const btn = container.querySelector('button[aria-label="Open menu"]');
    expect(btn).toBeTruthy();
  });

  it('Mobile-Menü ist initial nicht sichtbar', () => {
    renderHeader();
    const mobileMenu = container.querySelector('[data-testid="mobile-menu"]');
    expect(mobileMenu).toBeNull();
  });

  it('Klick auf Hamburger öffnet Mobile-Menü', () => {
    renderHeader();
    const btn = container.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    const mobileMenu = container.querySelector('[data-testid="mobile-menu"]');
    expect(mobileMenu).toBeTruthy();
  });

  it('Erneuter Klick auf Hamburger schließt Mobile-Menü wieder', () => {
    renderHeader();
    const openBtn = container.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement;
    act(() => {
      openBtn.click();
    });
    const closeBtn = container.querySelector('button[aria-label="Close menu"]') as HTMLButtonElement;
    act(() => {
      closeBtn.click();
    });
    const mobileMenu = container.querySelector('[data-testid="mobile-menu"]');
    expect(mobileMenu).toBeNull();
  });
});
