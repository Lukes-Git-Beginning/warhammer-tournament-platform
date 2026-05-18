import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface OnboardingSpotlightProps {
  targetSelector: string;
  title: string;
  body: string;
  padding?: number;
  /** Stable key — when changing, the bubble re-animates. */
  stopKey: string;
  /** Rendered below the bubble body — typically the Retreat/Advance controls. */
  controls?: React.ReactNode;
}

const FALLBACK_RECT: Rect = {
  top: 0,
  left: 0,
  width: 0,
  height: 0,
};

function readRect(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function OnboardingSpotlight({
  targetSelector,
  title,
  body,
  padding = 12,
  stopKey,
  controls,
}: OnboardingSpotlightProps) {
  const reduced = useReducedMotion();
  const location = useLocation();
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({
    w: typeof window === 'undefined' ? 1024 : window.innerWidth,
    h: typeof window === 'undefined' ? 768 : window.innerHeight,
  });

  useLayoutEffect(() => {
    const update = () => setRect(readRect(targetSelector));
    update();
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      update();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', update, { capture: true });
    const interval = window.setInterval(update, 600);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', update, { capture: true } as EventListenerOptions);
      window.clearInterval(interval);
    };
  }, [targetSelector, location.pathname]);

  useEffect(() => {
    setRect(readRect(targetSelector));
  }, [stopKey, targetSelector]);

  const haloRect: Rect = rect
    ? {
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      }
    : FALLBACK_RECT;

  const hasTarget = rect !== null;
  const bubblePlacement = computeBubblePlacement(haloRect, viewport);

  return (
    <>
      <svg
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[60] h-full w-full"
      >
        <defs>
          <mask id="onboarding-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {hasTarget && (
              <motion.rect
                initial={{
                  x: haloRect.left,
                  y: haloRect.top,
                  width: haloRect.width,
                  height: haloRect.height,
                  rx: 6,
                }}
                animate={{
                  x: haloRect.left,
                  y: haloRect.top,
                  width: haloRect.width,
                  height: haloRect.height,
                  rx: 6,
                }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 260, damping: 28 }
                }
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(8, 7, 10, 0.86)"
          mask="url(#onboarding-spotlight-mask)"
        />
        {hasTarget && (
          <motion.rect
            initial={false}
            animate={{
              x: haloRect.left - 1,
              y: haloRect.top - 1,
              width: haloRect.width + 2,
              height: haloRect.height + 2,
            }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: 'spring', stiffness: 260, damping: 28 }
            }
            rx={7}
            fill="none"
            stroke="rgb(212 160 23 / 0.65)"
            strokeWidth={1.5}
          />
        )}
      </svg>

      <AnimatePresence mode="wait">
        <motion.div
          key={stopKey}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={
            reduced
              ? { duration: 0.18 }
              : { duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }
          }
          style={
            hasTarget
              ? {
                  position: 'fixed',
                  top: bubblePlacement.top,
                  left: bubblePlacement.left,
                  maxWidth: '22rem',
                }
              : {
                  position: 'fixed',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  maxWidth: '22rem',
                }
          }
          className="z-[61] pointer-events-auto rounded-md border border-rizzotto-gold-500/40 bg-rizzotto-iron-900 p-5 shadow-rizzotto-gold-glow"
        >
          <h3 className="font-display text-[15px] uppercase tracking-wider text-rizzotto-gold-400">
            {title}
          </h3>
          <p className="mt-2 font-sans text-sm leading-relaxed text-rizzotto-stone-200">{body}</p>
          {controls && <div className="mt-4 flex items-center justify-between gap-3">{controls}</div>}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function computeBubblePlacement(
  rect: Rect,
  viewport: { w: number; h: number },
): { top: number; left: number } {
  const GAP = 14;
  const BUBBLE_W = 352; // matches max-w-22rem
  const BUBBLE_H_EST = 160;

  const spaceBelow = viewport.h - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const placeBelow = spaceBelow >= BUBBLE_H_EST + GAP || spaceBelow >= spaceAbove;

  const top = placeBelow ? rect.top + rect.height + GAP : Math.max(GAP, rect.top - BUBBLE_H_EST - GAP);
  let left = rect.left + rect.width / 2 - BUBBLE_W / 2;
  left = Math.max(GAP, Math.min(left, viewport.w - BUBBLE_W - GAP));
  return { top, left };
}
