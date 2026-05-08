import type { SiteAdapter } from "../types";
import { STVAdapter } from "./STV";
import { UukanshuAdapter } from "./Uukanshu";
import { PiaotiaAdapter } from "./Piaotia";
import { CuocengAdapter } from "./Cuoceng";
import { SixNineShuAdapter } from "./SixNineShu";
import { SixNineShuTwAdapter } from "./SixNineShuTw";
import { JjwxcAdapter } from "./Jjwxc";
import { XTruyenAdapter } from "./XTruyen";
import { MeTruyenChuAdapter } from "./MeTruyenChu";
import { ChomeredAdapter } from "./Chomered";
import { UniversalAdapter } from "./Universal";

const adapters: SiteAdapter[] = [
  STVAdapter,
  UukanshuAdapter,
  PiaotiaAdapter,
  CuocengAdapter,
  SixNineShuAdapter,
  SixNineShuTwAdapter,
  JjwxcAdapter,
  XTruyenAdapter,
  MeTruyenChuAdapter,
  ChomeredAdapter,
  UniversalAdapter,
];

/** Find the adapter that matches the given URL, or null. */
export function detectAdapter(url: string): SiteAdapter | null {
  // Try to find a specific adapter first
  const specific = adapters.slice(0, -1).find((a) => a.urlPattern.test(url));
  if (specific) return specific;
  
  // Fallback to Universal if it's a novel site URL (broad check)
  if (url.startsWith("http")) return UniversalAdapter;
  
  return null;
}

/** Get all registered adapters (for UI display). */
export function getAdapters(): SiteAdapter[] {
  return adapters;
}

export { STVAdapter, UukanshuAdapter, PiaotiaAdapter, CuocengAdapter, SixNineShuAdapter, SixNineShuTwAdapter, JjwxcAdapter, XTruyenAdapter, ChomeredAdapter, UniversalAdapter };
