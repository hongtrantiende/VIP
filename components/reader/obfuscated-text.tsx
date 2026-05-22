"use client";

import React, { useMemo } from "react";

interface ObfuscatedTextProps {
  text: string;
}

/**
 * A seedable 32-bit PRNG (Mulberry32) to generate deterministic pseudo-random values.
 * This guarantees consistent output for the same text to avoid React hydration mismatches.
 */
function createPrng(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return function () {
    h = (h + 0x9e3779b9) | 0;
    let z = h;
    z ^= z >>> 16;
    z = Math.imul(z, 0x21f0aa7f);
    z ^= z >>> 15;
    z = Math.imul(z, 0x735a2d97);
    z ^= z >>> 15;
    return (z >>> 0) / 4294967296;
  };
}

// Alphanumeric characters to build decoy/junk strings
const DECOY_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Regex to identify standard Latin-based/Vietnamese words that are safe to slice in half
const SAFE_LATIN_VIET_RE = /^[a-zA-Z0-9\u00C0-\u00FF\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]+$/;

export function ObfuscatedText({ text }: ObfuscatedTextProps) {
  const elements = useMemo(() => {
    if (!text) return null;

    const prng = createPrng(text);
    // Split by whitespace while preserving whitespace tokens
    const tokens = text.split(/(\s+)/);

    return tokens.map((token, idx) => {
      // 1. Whitespace tokens: render as standard text node
      if (/^\s+$/.test(token)) {
        return <span key={idx}>{token}</span>;
      }

      // 2. Decide if we should inject a decoy span (e.g. ~35% probability)
      const shouldInject = prng() < 0.35;
      if (!shouldInject) {
        return <span key={idx}>{token}</span>;
      }

      // 3. Generate a deterministic decoy junk string (1 to 3 characters)
      const junkLength = Math.floor(prng() * 3) + 1;
      let junk = "";
      for (let i = 0; i < junkLength; i++) {
        const charIndex = Math.floor(prng() * DECOY_CHARS.length);
        junk += DECOY_CHARS[charIndex];
      }

      // 4. If the token is a standard Latin/Vietnamese word and long enough, slice it.
      // Otherwise, keep the token whole and append the decoy to avoid breaking CJK surrogate pairs/emojis.
      if (token.length > 2 && SAFE_LATIN_VIET_RE.test(token)) {
        const splitPoint = Math.floor(token.length / 2);
        const part1 = token.slice(0, splitPoint);
        const part2 = token.slice(splitPoint);

        return (
          <span key={idx} className="inline">
            <span>{part1}</span>
            <span className="decoy" aria-hidden="true">
              {junk}
            </span>
            <span>{part2}</span>
          </span>
        );
      } else {
        return (
          <span key={idx} className="inline">
            <span>{token}</span>
            <span className="decoy" aria-hidden="true">
              {junk}
            </span>
          </span>
        );
      }
    });
  }, [text]);

  return <>{elements}</>;
}
