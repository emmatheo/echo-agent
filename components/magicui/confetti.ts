/**
 * components/magicui/confetti.ts
 * Matchday "ribbon celebration" helpers built on canvas-confetti.
 * Reserved for wins: wallet connected, premium payment settled.
 */
import confetti from "canvas-confetti";

const GOLD = ["#C9A24B", "#E7C877", "#F4DC9A", "#EDEBE6", "#FFFFFF"];

/** A single celebratory burst from a point (defaults to screen centre-low). */
export function fireBurst(originX = 0.5, originY = 0.7) {
  confetti({
    particleCount: 120,
    spread: 78,
    startVelocity: 42,
    origin: { x: originX, y: originY },
    colors: GOLD,
    scalar: 0.9,
    ticks: 220,
  });
}

/** Two gold "ribbon" cannons from the sides — the premium-settled signature. */
export function fireRibbons() {
  const end = Date.now() + 900;
  (function frame() {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      startVelocity: 55,
      origin: { x: 0, y: 0.75 },
      colors: GOLD,
      scalar: 1.1,
      ticks: 240,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      startVelocity: 55,
      origin: { x: 1, y: 0.75 },
      colors: GOLD,
      scalar: 1.1,
      ticks: 240,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

/** Small tap from a DOM element's position — for lighter button feedback. */
export function fireFromElement(el: HTMLElement | null) {
  if (!el) return fireBurst();
  const r = el.getBoundingClientRect();
  fireBurst(
    (r.left + r.width / 2) / window.innerWidth,
    (r.top + r.height / 2) / window.innerHeight,
  );
}
