/**
 * Communication bridge between Novel Studio and the Chrome extension.
 */

const STORAGE_KEY = "novel-studio:extension-id";
const GENERATOR_STORAGE_KEY = "novel-studio:generator-extension-id";
const TIMEOUT_KEY = "novel-studio:scrape-timeout";

export function getExtensionId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function setExtensionId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id.trim());
}

export function getGeneratorExtensionId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(GENERATOR_STORAGE_KEY) ?? "";
}

export function setGeneratorExtensionId(id: string): void {
  localStorage.setItem(GENERATOR_STORAGE_KEY, id.trim());
}

export function getScrapeTimeout(): number {
  if (typeof window === "undefined") return 15000;
  const val = localStorage.getItem(TIMEOUT_KEY);
  return val ? parseInt(val, 10) : 15000;
}

export function setScrapeTimeout(ms: number): void {
  localStorage.setItem(TIMEOUT_KEY, String(ms));
}

// ─── Chrome API typing ─────────────────────────────────────

interface ExtensionResponse {
  ok: boolean;
  html?: string;
  contentText?: string;
  timedOut?: boolean;
  logs?: string[];
  error?: string;
  version?: string;
  success?: boolean; // For legacy STV support
}

function getChromeRuntime(): any {
  const c = (globalThis as any).chrome;
  if (c?.runtime?.sendMessage) return c.runtime;
  return null;
}

// ─── Core Logic ────────────────────────────────────────────

async function sendMessage(extensionId: string, message: unknown): Promise<ExtensionResponse> {
  return new Promise((resolve, reject) => {
    const runtime = getChromeRuntime();
    if (!runtime) {
      reject(new Error("Chrome Extension API không khả dụng."));
      return;
    }

    if (!extensionId) {
      reject(new Error("Extension ID chưa được cấu hình."));
      return;
    }

    runtime.sendMessage(extensionId, message, (response: unknown) => {
      if (!response) {
        reject(new Error("Không có phản hồi từ Extension."));
        return;
      }
      resolve(response as ExtensionResponse);
    });
  });
}

export async function extensionFetch(
  url: string,
  options: {
    waitSelector?: string;
    clickSelector?: string;
    timeout?: number;
    extensionId?: string;
    smartScrape?: string;
    reuseTab?: boolean;
  } = {}
) {
  const id = options.extensionId || getExtensionId();
  const timeout = options.timeout || getScrapeTimeout();
  
  const response = await sendMessage(id, { 
    type: "FETCH", 
    url, 
    ...options,
    timeout 
  });
  
  if (!response.ok) {
    throw new Error(response.error ?? "Extension fetch failed");
  }
  return {
    html: response.html!,
    contentText: response.contentText ?? undefined,
    timedOut: response.timedOut ?? false,
    logs: response.logs,
  };
}

export async function extensionDownloadSTVChapter(
  chapterId: string | number,
  chapterUrl: string,
  allowNext: boolean = true,
): Promise<any> {
  const id = getExtensionId();
  const response = await sendMessage(id, {
    action: "downloadChapter",
    payload: { chapterId, chapterUrl, allowNext },
  });
  return response;
}

export async function extensionStopScrape(): Promise<void> {
  const id = getExtensionId();
  try {
    await sendMessage(id, { action: "stopScrape" });
  } catch (err) {
    console.warn("Stop scrape signal failed:", err);
  }
}

export async function checkExtensionStatus(specificId?: string): Promise<{
  available: boolean;
  version: string | null;
}> {
  const id = specificId || getExtensionId();
  if (!id) return { available: false, version: null };

  try {
    const response = await Promise.race([
      sendMessage(id, { type: "PING" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 3000),
      ),
    ]);
    return {
      available: response.ok === true,
      version: response.version ?? null,
    };
  } catch {
    return { available: false, version: null };
  }
}

export function isAndroid(): boolean {
  if (typeof window === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * @deprecated Use checkExtensionStatus instead
 */
export async function isExtensionAvailable(): Promise<boolean> {
  const { available } = await checkExtensionStatus();
  return available;
}
