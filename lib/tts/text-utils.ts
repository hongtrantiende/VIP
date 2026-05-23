import type { Sentence } from "./providers/types";

function rotateLeft(value: number, amount: number): number {
  return (value << amount) | (value >>> (32 - amount));
}

function addUnsigned(x: number, y: number): number {
  const x4 = x & 0x40000000;
  const y4 = y & 0x40000000;
  const x8 = x & 0x80000000;
  const y8 = y & 0x80000000;
  const result = (x & 0x3fffffff) + (y & 0x3fffffff);
  if (x4 & y4) return result ^ 0x80000000 ^ x8 ^ y8;
  if (x4 | y4) {
    return result & 0x40000000
      ? result ^ 0xc0000000 ^ x8 ^ y8
      : result ^ 0x40000000 ^ x8 ^ y8;
  }
  return result ^ x8 ^ y8;
}

function F(x: number, y: number, z: number) {
  return (x & y) | (~x & z);
}
function G(x: number, y: number, z: number) {
  return (x & z) | (y & ~z);
}
function H(x: number, y: number, z: number) {
  return x ^ y ^ z;
}
function I(x: number, y: number, z: number) {
  return y ^ (x | ~z);
}

function FF(
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  s: number,
  ac: number,
) {
  a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
  return addUnsigned(rotateLeft(a, s), b);
}
function GG(
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  s: number,
  ac: number,
) {
  a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
  return addUnsigned(rotateLeft(a, s), b);
}
function HH(
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  s: number,
  ac: number,
) {
  a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
  return addUnsigned(rotateLeft(a, s), b);
}
function II(
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  s: number,
  ac: number,
) {
  a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
  return addUnsigned(rotateLeft(a, s), b);
}

function convertToWordArray(str: string): number[] {
  const messageLength = str.length;
  const numberOfWords =
    ((messageLength + 8 - ((messageLength + 8) % 64)) / 64 + 1) * 16;
  const wordArray: number[] = new Array<number>(numberOfWords).fill(0);

  let bytePosition = 0;
  let byteCount = 0;
  while (byteCount < messageLength) {
    const wordCount = (byteCount - (byteCount % 4)) / 4;
    bytePosition = (byteCount % 4) * 8;
    wordArray[wordCount] =
      wordArray[wordCount]! | (str.charCodeAt(byteCount) << bytePosition);
    byteCount++;
  }
  const wordCount = (byteCount - (byteCount % 4)) / 4;
  bytePosition = (byteCount % 4) * 8;
  wordArray[wordCount] = wordArray[wordCount]! | (0x80 << bytePosition);
  wordArray[numberOfWords - 2] = messageLength << 3;
  wordArray[numberOfWords - 1] = messageLength >>> 29;
  return wordArray;
}

function wordToHex(value: number): string {
  let hex = "";
  for (let count = 0; count <= 3; count++) {
    const byte = (value >>> (count * 8)) & 255;
    hex += ("0" + byte.toString(16)).slice(-2);
  }
  return hex;
}

/**
 * Pure-JS MD5 hash. Returns a 32-char lowercase hex string.
 * Used as cache key for audio blobs.
 */
export function md5(text: string): string {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  const x = convertToWordArray(text);

  for (let k = 0; k < x.length; k += 16) {
    const AA = h0,
      BB = h1,
      CC = h2,
      DD = h3;

    h0 = FF(h0, h1, h2, h3, x[k]!, 7, 0xd76aa478);
    h3 = FF(h3, h0, h1, h2, x[k + 1]!, 12, 0xe8c7b756);
    h2 = FF(h2, h3, h0, h1, x[k + 2]!, 17, 0x242070db);
    h1 = FF(h1, h2, h3, h0, x[k + 3]!, 22, 0xc1bdceee);
    h0 = FF(h0, h1, h2, h3, x[k + 4]!, 7, 0xf57c0faf);
    h3 = FF(h3, h0, h1, h2, x[k + 5]!, 12, 0x4787c62a);
    h2 = FF(h2, h3, h0, h1, x[k + 6]!, 17, 0xa8304613);
    h1 = FF(h1, h2, h3, h0, x[k + 7]!, 22, 0xfd469501);
    h0 = FF(h0, h1, h2, h3, x[k + 8]!, 7, 0x698098d8);
    h3 = FF(h3, h0, h1, h2, x[k + 9]!, 12, 0x8b44f7af);
    h2 = FF(h2, h3, h0, h1, x[k + 10]!, 17, 0xffff5bb1);
    h1 = FF(h1, h2, h3, h0, x[k + 11]!, 22, 0x895cd7be);
    h0 = FF(h0, h1, h2, h3, x[k + 12]!, 7, 0x6b901122);
    h3 = FF(h3, h0, h1, h2, x[k + 13]!, 12, 0xfd987193);
    h2 = FF(h2, h3, h0, h1, x[k + 14]!, 17, 0xa679438e);
    h1 = FF(h1, h2, h3, h0, x[k + 15]!, 22, 0x49b40821);

    h0 = GG(h0, h1, h2, h3, x[k + 1]!, 5, 0xf61e2562);
    h3 = GG(h3, h0, h1, h2, x[k + 6]!, 9, 0xc040b340);
    h2 = GG(h2, h3, h0, h1, x[k + 11]!, 14, 0x265e5a51);
    h1 = GG(h1, h2, h3, h0, x[k]!, 20, 0xe9b6c7aa);
    h0 = GG(h0, h1, h2, h3, x[k + 5]!, 5, 0xd62f105d);
    h3 = GG(h3, h0, h1, h2, x[k + 10]!, 9, 0x02441453);
    h2 = GG(h2, h3, h0, h1, x[k + 15]!, 14, 0xd8a1e681);
    h1 = GG(h1, h2, h3, h0, x[k + 4]!, 20, 0xe7d3fbc8);
    h0 = GG(h0, h1, h2, h3, x[k + 9]!, 5, 0x21e1cde6);
    h3 = GG(h3, h0, h1, h2, x[k + 14]!, 9, 0xc33707d6);
    h2 = GG(h2, h3, h0, h1, x[k + 3]!, 14, 0xf4d50d87);
    h1 = GG(h1, h2, h3, h0, x[k + 8]!, 20, 0x455a14ed);
    h0 = GG(h0, h1, h2, h3, x[k + 13]!, 5, 0xa9e3e905);
    h3 = GG(h3, h0, h1, h2, x[k + 2]!, 9, 0xfcefa3f8);
    h2 = GG(h2, h3, h0, h1, x[k + 7]!, 14, 0x676f02d9);
    h1 = GG(h1, h2, h3, h0, x[k + 12]!, 20, 0x8d2a4c8a);

    h0 = HH(h0, h1, h2, h3, x[k + 5]!, 4, 0xfffa3942);
    h3 = HH(h3, h0, h1, h2, x[k + 8]!, 11, 0x8771f681);
    h2 = HH(h2, h3, h0, h1, x[k + 11]!, 16, 0x6d9d6122);
    h1 = HH(h1, h2, h3, h0, x[k + 14]!, 23, 0xfde5380c);
    h0 = HH(h0, h1, h2, h3, x[k + 1]!, 4, 0xa4beea44);
    h3 = HH(h3, h0, h1, h2, x[k + 4]!, 11, 0x4bdecfa9);
    h2 = HH(h2, h3, h0, h1, x[k + 7]!, 16, 0xf6bb4b60);
    h1 = HH(h1, h2, h3, h0, x[k + 10]!, 23, 0xbebfbc70);
    h0 = HH(h0, h1, h2, h3, x[k + 13]!, 4, 0x289b7ec6);
    h3 = HH(h3, h0, h1, h2, x[k]!, 11, 0xeaa127fa);
    h2 = HH(h2, h3, h0, h1, x[k + 3]!, 16, 0xd4ef3085);
    h1 = HH(h1, h2, h3, h0, x[k + 6]!, 23, 0x04881d05);
    h0 = HH(h0, h1, h2, h3, x[k + 9]!, 4, 0xd9d4d039);
    h3 = HH(h3, h0, h1, h2, x[k + 12]!, 11, 0xe6db99e5);
    h2 = HH(h2, h3, h0, h1, x[k + 15]!, 16, 0x1fa27cf8);
    h1 = HH(h1, h2, h3, h0, x[k + 2]!, 23, 0xc4ac5665);

    h0 = II(h0, h1, h2, h3, x[k]!, 6, 0xf4292244);
    h3 = II(h3, h0, h1, h2, x[k + 7]!, 10, 0x432aff97);
    h2 = II(h2, h3, h0, h1, x[k + 14]!, 15, 0xab9423a7);
    h1 = II(h1, h2, h3, h0, x[k + 5]!, 21, 0xfc93a039);
    h0 = II(h0, h1, h2, h3, x[k + 12]!, 6, 0x655b59c3);
    h3 = II(h3, h0, h1, h2, x[k + 3]!, 10, 0x8f0ccc92);
    h2 = II(h2, h3, h0, h1, x[k + 10]!, 15, 0xffeff47d);
    h1 = II(h1, h2, h3, h0, x[k + 1]!, 21, 0x85845dd1);
    h0 = II(h0, h1, h2, h3, x[k + 8]!, 6, 0x6fa87e4f);
    h3 = II(h3, h0, h1, h2, x[k + 15]!, 10, 0xfe2ce6e0);
    h2 = II(h2, h3, h0, h1, x[k + 6]!, 15, 0xa3014314);
    h1 = II(h1, h2, h3, h0, x[k + 13]!, 21, 0x4e0811a1);
    h0 = II(h0, h1, h2, h3, x[k + 4]!, 6, 0xf7537e82);
    h3 = II(h3, h0, h1, h2, x[k + 11]!, 10, 0xbd3af235);
    h2 = II(h2, h3, h0, h1, x[k + 2]!, 15, 0x2ad7d2bb);
    h1 = II(h1, h2, h3, h0, x[k + 9]!, 21, 0xeb86d391);

    h0 = addUnsigned(h0, AA);
    h1 = addUnsigned(h1, BB);
    h2 = addUnsigned(h2, CC);
    h3 = addUnsigned(h3, DD);
  }

  return (
    wordToHex(h0) +
    wordToHex(h1) +
    wordToHex(h2) +
    wordToHex(h3)
  ).toLowerCase();
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/**
 * Regex for Vietnamese + Latin speakable characters.
 * Matches alphanumeric plus Vietnamese diacritics and the dong sign.
 */
const SPEAKABLE_RE = /[A-Za-z0-9\u00C0-\u00FF\u0102\u1EA0-\u1EF9\u20AB]+/g;

/**
 * Stop tokens used to split text into sentences.
 * Matches sentence-ending punctuation and quote marks, followed by optional
 * whitespace. Ellipsis ("...") is excluded from splitting.
 */
const STOP_TOKEN_RE = /([.!?\u201C\u201D\u201E\u201F"""\n]+)\s*/;

/**
 * Returns `true` if `text` contains at least one speakable
 * (alphanumeric / Vietnamese) character.
 */
export function haveSpeakableText(text: string): boolean {
  // Reset lastIndex since SPEAKABLE_RE has the global flag
  SPEAKABLE_RE.lastIndex = 0;
  return SPEAKABLE_RE.test(text);
}

/**
 * Normalize text for cache-key / comparison purposes.
 *
 * - Strips curly/straight quotes
 * - Trims leading/trailing punctuation
 * - Lowercases
 * - Collapses whitespace
 */
export function normalizeText(text: string): string {
  // Strip HTML tags / comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<[^>]*>/g, "");
  
  // Replace quotes with spaces
  text = text.replace(/[\u201C\u201D\u201E\u201F""'`]/g, " ");
  
  // Replace symbols that can cause crackling / glitching in Piper with spaces
  text = text.replace(/[~*_+\-=\\/|()[\]{}]/g, " ");
  
  // Replace multiple consecutive periods/ellipsis with a comma to create a natural pause
  text = text.replace(/\.{2,}/g, ", ");
  
  // Trim leading/trailing punctuation and whitespace
  text = text.replace(/^[.,!?\s\n]+|[.,!?\s\n]+$/g, "");
  
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Split plain text into an array of {@link Sentence} objects.
 *
 * Splitting happens at sentence-ending punctuation (`.` `!` `?`), quotation
 * marks, and newlines. Ellipsis (`...`) does NOT trigger a split.
 * Empty / non-speakable fragments are filtered out.
 */
export function tokenizeSentences(text: string): Sentence[] {
  const raw: { text: string; originalText: string }[] = [];
  let current = "";

  const parts = text.split(STOP_TOKEN_RE);

  for (const part of parts) {
    if (!part.trim() && part !== "\n") continue;

    // If this part is a stop-token group (and not an ellipsis), it ends the
    // current sentence.
    if (STOP_TOKEN_RE.test(part) && !part.includes("...")) {
      current += part;
      if (current.trim()) {
        raw.push({
          originalText: current.trim(),
          text: normalizeText(current.trim()),
        });
      }
      current = "";
    } else {
      current += (current ? " " : "") + part;
    }
  }

  // Flush remaining text
  if (current.trim()) {
    raw.push({
      originalText: current.trim(),
      text: normalizeText(current.trim()),
    });
  }

  // Filter non-speakable, assign sequential index
  return raw
    .filter((s) => s.text.length > 0 && haveSpeakableText(s.text))
    .map((s, i) => ({ ...s, index: i }));
}

/**
 * Prepare text for actual speech synthesis.
 * Preserves letter case and standard punctuation (periods, commas, exclamation marks, etc.)
 * for natural intonation, but strips HTML tags, comments, and glitch-prone characters.
 */
export function getSpeakableText(text: string): string {
  if (!text) return "";
  
  // Strip HTML tags / comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<[^>]*>/g, "");
  
  // Replace glitch-inducing characters with spaces
  text = text.replace(/[~*_+\-=\\/|()[\]{}]/g, " ");
  
  // Replace multiple consecutive periods/ellipsis with a comma to create a natural pause
  text = text.replace(/\.{2,}/g, ", ");
  
  return text.replace(/\s+/g, " ").trim();
}

