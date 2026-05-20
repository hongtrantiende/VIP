/**
 * Utility functions for Gzip compression and decompression using native web standards.
 * Fully compatible with modern browsers and Node.js 18+ (Cloudflare Workers, Next.js Edge).
 */

export async function compress(str: string): Promise<Uint8Array> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(str));
      controller.close();
    }
  }).pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(stream).blob();
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function decompress(bytes: Uint8Array): Promise<string> {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  }).pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function decompressIfNeeded(bytes: Uint8Array): Promise<string> {
  if (isGzip(bytes)) {
    return await decompress(bytes);
  }
  return new TextDecoder().decode(bytes);
}
