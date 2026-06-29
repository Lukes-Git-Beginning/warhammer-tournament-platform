import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { RefObject, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// N16: Active-Match Visibility Context
//
// Provides a Set<string> (matchIds) of tiles that are currently visible in the
// viewport.  Each GameTile registers/unregisters itself via useReportTileVisible.
//
// Design constraints:
//  - visibleSet is stored in a ref to avoid triggering renders on every
//    scroll/intersection event.  A separate state counter is flipped only when
//    the set actually changes so consumers can subscribe without render-loops.
//  - The provider exposes a stable `register` / `unregister` pair rather than
//    putting the Set itself in state, which would create a new object on every
//    mutation and force all children to re-render.
// ---------------------------------------------------------------------------

interface ContextValue {
  /** Current set of visible matchIds (ref-stable object, do not mutate). */
  visibleSet: Set<string>;
  /** Internal-use: subscription counter bumped when visibleSet changes. */
  version: number;
  register: (matchId: string) => void;
  unregister: (matchId: string) => void;
}

const ActiveMatchVisibilityContext = createContext<ContextValue | null>(null);

export function ActiveMatchVisibilityProvider({ children }: { children: ReactNode }) {
  const visibleRef = useRef<Set<string>>(new Set());
  const [version, setVersion] = useState(0);

  const register = useCallback((matchId: string) => {
    if (!visibleRef.current.has(matchId)) {
      visibleRef.current.add(matchId);
      setVersion((v) => v + 1);
    }
  }, []);

  const unregister = useCallback((matchId: string) => {
    if (visibleRef.current.has(matchId)) {
      visibleRef.current.delete(matchId);
      setVersion((v) => v + 1);
    }
  }, []);

  return (
    <ActiveMatchVisibilityContext.Provider
      value={{ visibleSet: visibleRef.current, version, register, unregister }}
    >
      {children}
    </ActiveMatchVisibilityContext.Provider>
  );
}

function useActiveMatchVisibility(): ContextValue {
  const ctx = useContext(ActiveMatchVisibilityContext);
  if (!ctx) {
    throw new Error('useActiveMatchVisibility must be used inside ActiveMatchVisibilityProvider');
  }
  return ctx;
}

/**
 * Attach the returned ref to a tile's root element.  While the element is in
 * the viewport the matchId is registered as visible; when it leaves (or the
 * component unmounts) it is unregistered.
 */
export function useReportTileVisible(matchId: string): RefObject<HTMLDivElement | null> {
  const { register, unregister } = useActiveMatchVisibility();
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          register(matchId);
        } else {
          unregister(matchId);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);

    return () => {
      observer.unobserve(el);
      // Clean up when unmounting so the set stays accurate
      unregister(matchId);
    };
  }, [matchId, register, unregister]);

  return elementRef;
}

/**
 * Returns the current set of visible matchIds and re-renders when it changes.
 * Use this in the header indicator component.
 */
export function useVisibleMatchIds(): Set<string> {
  const { visibleSet, version: _version } = useActiveMatchVisibility();
  return visibleSet;
}
