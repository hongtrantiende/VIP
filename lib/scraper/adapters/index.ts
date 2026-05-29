import type { SiteAdapter } from "../types";
import { STVAdapter } from "./STV";
import { UukanshuAdapter } from "./Uukanshu";
import { PiaotiaAdapter } from "./Piaotia";
import { CuocengAdapter } from "./Cuoceng";
import { SixNineShuAdapter } from "./SixNineShu";
import { SixNineShuTwAdapter } from "./SixNineShuTw";
import { JjwxcAdapter } from "./Jjwxc";
import { XTruyenAdapter } from "./XTruyen";

import { ChomeredAdapter } from "./Chomered";
import { WeloveGourmetAdapter } from "./WeloveGourmet";
import { BjtrizAdapter } from "./Bjtriz";
import { ParentsNoteAdapter } from "./ParentsNote";
import { FooddierAdapter } from "./Fooddier";
import { Po18Adapter } from "./Po18";
import { GuihuaAdapter } from "./Guihua";
import { TimotxtAdapter } from "./Timotxt";
import { CzbooksAdapter } from "./Czbooks";
import { FanqieAdapter } from "./Fanqie";
import { BookQQAdapter } from "./BookQQ";
import { WikiDichAdapter } from "./WikiDich";
import { UniversalAdapter } from "./Universal";
import { ZhihuAdapter } from "./Zhihu";
import { Novel543Adapter } from "./Novel543";
import { Shuku52Adapter } from "./Shuku52";
import { WordpressAdapter } from "./Wordpress";
import { TruyenFullVisionAdapter } from "./TruyenFullVision";
import { TruyenMoAdapter } from "./TruyenMo";
import { HaiTangSoShuAdapter } from "./HaiTangSoShu";
import { HeTuShuAdapter } from "./HeTuShu";
import { XBanXiaAdapter } from "./XBanXia";
import { PetfamaAdapter } from "./Petfama";
import { WealwomenAdapter } from "./Wealwomen";

const adapters: SiteAdapter[] = [
  STVAdapter,
  UukanshuAdapter,
  PiaotiaAdapter,
  CuocengAdapter,
  SixNineShuAdapter,
  SixNineShuTwAdapter,
  JjwxcAdapter,
  XTruyenAdapter,

  ChomeredAdapter,
  WeloveGourmetAdapter,
  BjtrizAdapter,
  ParentsNoteAdapter,
  FooddierAdapter,
  Po18Adapter,
  GuihuaAdapter,
  TimotxtAdapter,
  CzbooksAdapter,
  FanqieAdapter,
  BookQQAdapter,
  WikiDichAdapter,
  ZhihuAdapter,
  Novel543Adapter,
  Shuku52Adapter,
  WordpressAdapter,
  TruyenFullVisionAdapter,
  TruyenMoAdapter,
  HaiTangSoShuAdapter,
  HeTuShuAdapter,
  XBanXiaAdapter,
  PetfamaAdapter,
  WealwomenAdapter,
  UniversalAdapter,  // Must be LAST — detectAdapter uses slice(0, -1) to skip it
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

export { STVAdapter, UukanshuAdapter, PiaotiaAdapter, CuocengAdapter, SixNineShuAdapter, SixNineShuTwAdapter, JjwxcAdapter, XTruyenAdapter, ChomeredAdapter, WeloveGourmetAdapter, BjtrizAdapter, ParentsNoteAdapter, FooddierAdapter, FanqieAdapter, BookQQAdapter, WikiDichAdapter, UniversalAdapter, ZhihuAdapter, Novel543Adapter, Shuku52Adapter, WordpressAdapter, TruyenFullVisionAdapter, TruyenMoAdapter, HaiTangSoShuAdapter, HeTuShuAdapter, XBanXiaAdapter, PetfamaAdapter, WealwomenAdapter };
