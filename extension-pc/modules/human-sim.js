/**
 * Human simulation module — realistic delay & behavior simulation.
 * Contains: gaussian delay, adaptive throttle, mouse movement & scroll simulation.
 */

import { delay } from "./utils.js";

// ══════════════════════════════════════════════════════════════
// Gaussian Random & Human-like Delays
// ══════════════════════════════════════════════════════════════

/**
 * Generate a Gaussian-distributed random number.
 * @param {number} mean - Center value.
 * @param {number} stddev - Standard deviation.
 * @returns {number} A random value, clamped to at least 30% of mean.
 */
export function gaussianRandom(mean, stddev) {
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(mean * 0.3, mean + z * stddev);
}

/**
 * Generate a human-like delay with natural variance.
 * @param {number} baseMs - Base delay in milliseconds.
 * @returns {number} Delay with Gaussian noise applied.
 */
export function humanDelay(baseMs) {
  return gaussianRandom(baseMs, baseMs * 0.3);
}

// ══════════════════════════════════════════════════════════════
// Adaptive Throttle — increases delay on errors, decreases on success
// ══════════════════════════════════════════════════════════════

let adaptiveMultiplier = 1;

/**
 * Get an adaptive delay that scales with error frequency.
 * @param {number} baseMs - Base delay in ms.
 * @returns {number} Scaled delay.
 */
export function getAdaptiveDelay(baseMs) {
  return humanDelay(baseMs * adaptiveMultiplier);
}

/** Increase throttle by 1.5x (capped at 5x) after an error. */
export function increaseThrottle() {
  adaptiveMultiplier = Math.min(adaptiveMultiplier * 1.5, 5);
}

/** Decrease throttle by 0.8x (floor at 1x) after a success. */
export function decreaseThrottle() {
  adaptiveMultiplier = Math.max(adaptiveMultiplier * 0.8, 1);
}

// ══════════════════════════════════════════════════════════════
// Human Behavior Simulation — mouse movement & scrolling
// ══════════════════════════════════════════════════════════════

/**
 * Simulate realistic human behavior in a tab: random mouse movements
 * and gradual scrolling.
 *
 * @param {number} tabId - Chrome tab ID to simulate behavior in.
 */
export async function simulateHuman(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Random mouse movements
        const dispatchMouse = (x, y) => {
          document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
        };
        for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
          setTimeout(() => {
            dispatchMouse(Math.random() * window.innerWidth * 0.8 + 50, Math.random() * window.innerHeight * 0.6 + 50);
          }, i * (150 + Math.random() * 200));
        }

        // Gradual scroll
        const totalScroll = document.documentElement.scrollHeight * (0.3 + Math.random() * 0.4);
        let scrolled = 0;
        const scrollStep = () => {
          if (scrolled >= totalScroll) return;
          const step = 80 + Math.random() * 150;
          window.scrollBy(0, step);
          scrolled += step;
          setTimeout(scrollStep, 100 + Math.random() * 300);
        };
        setTimeout(scrollStep, 300 + Math.random() * 500);
      },
    });
    // Wait for scroll to mostly complete
    await delay(800 + Math.random() * 600);
  } catch {}
}
