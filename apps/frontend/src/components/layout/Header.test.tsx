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

  it('zeigt RizzOtto Logo-Link zum Home', () => {
    renderHeader();
    const logo = container.querySelector('a[href="/"]');
    expect(logo).toBeTruthy();
    expect(logo?.getAttribute('aria-label')).toContain('RizzOtto');
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

  it('closes the menu after a click on one of its links', () => {
    renderHeader();
    const openBtn = container.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement;
    act(() => {
      openBtn.click();
    });
    const link = container.querySelector('[data-testid="mobile-menu"] a') as HTMLAnchorElement;
    link.addEventListener('click', (e) => e.preventDefault());
    act(() => {
      link.click();
    });
    expect(container.querySelector('[data-testid="mobile-menu"]')).toBeNull();
  });

  describe('when the tabs do not fit next to the logo and the auth area', () => {
    let resized: () => void;

    beforeEach(() => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resized = callback;
          }
          observe() {}
          disconnect() {}
        },
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function layOut(linksWidth: number, navWidth: number) {
      const nav = container.querySelector('nav[aria-label="Primary"]') as HTMLElement;
      Object.defineProperty(nav, 'clientWidth', { configurable: true, value: navWidth });
      Object.defineProperty(nav.firstElementChild, 'offsetWidth', {
        configurable: true,
        value: linksWidth,
      });
      act(() => resized());
      return {
        nav,
        hamburger: container.querySelector('button[aria-label="Open menu"]') as HTMLButtonElement,
      };
    }

    it('hides the nav and keeps the hamburger on wide windows', () => {
      renderHeader();
      const { nav, hamburger } = layOut(1120, 1000);
      expect(nav.className).toContain('invisible');
      expect(hamburger.className).not.toContain('xl:hidden');
    });

    it('shows the nav again and leaves the hamburger to narrow windows once they fit', () => {
      renderHeader();
      layOut(1120, 1000);
      const { nav, hamburger } = layOut(1120, 1120);
      expect(nav.className).not.toContain('invisible');
      expect(hamburger.className).toContain('xl:hidden');
    });

    it('counts the room the hamburger itself takes, so the same width decides both ways', () => {
      renderHeader();
      layOut(1120, 1000);
      expect(layOut(1120, 1073).nav.className).toContain('invisible');
      expect(layOut(1120, 1074).nav.className).not.toContain('invisible');
    });

    it('opens the menu on wide windows too while the tabs do not fit', () => {
      renderHeader();
      const { hamburger } = layOut(1120, 1000);
      act(() => hamburger.click());
      const menu = container.querySelector('[data-testid="mobile-menu"]');
      expect(menu?.className).not.toContain('xl:hidden');
    });
  });
});
