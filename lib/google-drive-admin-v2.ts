let cachedToken: string | null = null;
let tokenExpiryTime: number = 0;
let cachedIndexFileId: string | undefined = undefined;

class SimpleMutex {
  private queue = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void = () => { };
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = this.queue;
    this.queue = next;
    await current;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const readingRoomIndexMutex = new SimpleMutex();

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { decompressIfNeeded } from "./compression";

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiryTime) {
    return cachedToken;
  }

  let clientId = process.env.GOOGLE_CLIENT_ID || '';
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN || '';

  let envKeys = "none";
  // Fallback lấy từ Cloudflare Context trong môi trường OpenNext
  try {
    const ctx = getCloudflareContext();
    if (ctx && ctx.env) {
      envKeys = Object.keys(ctx.env).join(", ");
      clientId = clientId || ((ctx.env as any).GOOGLE_CLIENT_ID as string) || '';
      clientSecret = clientSecret || ((ctx.env as any).GOOGLE_CLIENT_SECRET as string) || '';
      refreshToken = refreshToken || ((ctx.env as any).GOOGLE_REFRESH_TOKEN as string) || '';
    }
  } catch (err) {
    console.warn("getCloudflareContext failed or not available:", err);
  }

  if (!refreshToken) {
    throw new Error(`Missing GOOGLE_REFRESH_TOKEN. Available env keys: ${envKeys}`);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error("Lỗi lấy Access Token từ Google: " + (data.error_description || data.error));
  }

  cachedToken = data.access_token;
  // Expire 1 phút trước khi hết hạn thật để an toàn
  tokenExpiryTime = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken!;
}

// ── Constants ──
const MASTER_FOLDER_NAME = 'Kho_chua_du_lieu_App';
const DICT_FOLDER_NAME = 'Tu_dien';
const NOVEL_ROOT_FOLDER_NAME = 'Truyen_nguoi_dung';
const TXT_ROOT_FOLDER_NAME = 'Kho_van_ban_TXT';
const COMMUNITY_DICT_FOLDER_NAME = 'Tu_dien_cong_dong';
const BOT_QUEUE_FOLDER_NAME = 'Bot_Queue';
const READING_ROOM_FOLDER_NAME = 'Phong_doc_cong_dong';

const folderCache: Record<string, Promise<string>> = {};

async function fetchDriveAPI(url: string, options: RequestInit = {}, raw?: boolean) {
  let lastError: any = null;
  const maxAttempts = 4;
  const baseDelay = 1000; // start with 1s

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const token = await getAccessToken();
      const headers = new Headers(options.headers || {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const res = await fetch(url, { cache: 'no-store', ...options, headers });
      if (!res.ok) {
        const text = await res.text();
        const errStatus = res.status;
        const isRateLimitOrRetryable = errStatus === 429 || errStatus === 403 || errStatus >= 500;

        if (isRateLimitOrRetryable && attempt < maxAttempts) {
          const jitter = 0.8 + Math.random() * 0.4;
          const delay = Math.round(baseDelay * Math.pow(2, attempt - 1) * jitter);
          console.warn(`[DriveAPI] Fetch failed (${errStatus}). Retrying in ${delay}ms... (Attempt ${attempt}/${maxAttempts})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`Google Drive API Error (${res.status}): ${text}`);
      }

      // Nếu là tải file dạng text (alt=media)
      if (url.includes('alt=media')) {
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (raw) {
          return bytes;
        }
        return await decompressIfNeeded(bytes);
      }
      // Delete trả về empty
      if (options.method === 'DELETE') return null;
      return await res.json();

    } catch (err: any) {
      lastError = err;
      if (attempt < maxAttempts) {
        const jitter = 0.8 + Math.random() * 0.4;
        const delay = Math.round(baseDelay * Math.pow(2, attempt - 1) * jitter);
        console.warn(`[DriveAPI] Network/API exception: ${err.message}. Retrying in ${delay}ms... (Attempt ${attempt}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("Failed to contact Google Drive API");
}

/** Find or create a folder by name under a parent (Race-condition safe) */
async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const cacheKey = `${parentId || 'root'}_${name}`;

  if (cacheKey in folderCache) {
    return folderCache[cacheKey];
  }

  const createPromise = (async () => {
    const safeName = name.replace(/'/g, "\\'");
    const q = encodeURIComponent(`name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentId ? ` and '${parentId}' in parents` : ''}`);
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`;

    // 1. Thử tìm xem đã có chưa
    const searchRes = await fetchDriveAPI(searchUrl);
    if (searchRes.files && searchRes.files.length > 0) {
      return searchRes.files[0].id;
    }

    // 2. Nếu chưa có, tiến hành tạo mới
    try {
      const createRes = await fetchDriveAPI('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: parentId ? [parentId] : undefined,
        })
      });
      return createRes.id;
    } catch (err: any) {
      // Retry
      const retryRes = await fetchDriveAPI(searchUrl);
      if (retryRes.files && retryRes.files.length > 0) {
        return retryRes.files[0].id;
      }
      throw err;
    }
  })();

  folderCache[cacheKey] = createPromise;
  setTimeout(() => { delete folderCache[cacheKey]; }, 24 * 60 * 60 * 1000);

  return createPromise;
}

/** Get the private novel folder for a specific user under the master structure */
async function getUserNovelFolder(userIdentifier: string): Promise<string> {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const novelRootId = await findOrCreateFolder(NOVEL_ROOT_FOLDER_NAME, masterId);
  return await findOrCreateFolder(userIdentifier, novelRootId);
}

/** Get the private TXT folder under the master structure */
async function getTxtFolder(type: 'text_trung' | 'text_dich'): Promise<string> {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const txtRootId = await findOrCreateFolder(TXT_ROOT_FOLDER_NAME, masterId);
  return await findOrCreateFolder(type, txtRootId);
}

/** Helper function for Multipart upload (cho file nhỏ hoặc vừa, hỗ trợ binary và text) */
async function uploadResumable(
  filename: string,
  content: string | ArrayBuffer | Uint8Array,
  mimeType: string,
  parentId?: string,
  fileIdToUpdate?: string
) {
  const metadata = {
    name: filename,
    mimeType: mimeType,
    ...(fileIdToUpdate ? {} : { parents: parentId ? [parentId] : undefined })
  };

  const bodyBytes = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : (content instanceof ArrayBuffer ? new Uint8Array(content) : content);

  const initUrl = fileIdToUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileIdToUpdate}?uploadType=resumable`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
  const initMethod = fileIdToUpdate ? "PATCH" : "POST";

  // 1. Khởi tạo phiên tải lên Resumable (gửi metadata trước)
  const token = await getAccessToken();
  const initRes = await fetch(initUrl, {
    method: initMethod,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(bodyBytes.length)
    },
    body: JSON.stringify(metadata)
  });

  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`Google Drive Resumable Init Error (${initRes.status}): ${text}`);
  }

  const sessionUrl = initRes.headers.get('Location');
  if (!sessionUrl) {
    throw new Error("Không nhận được session URL (Location header) từ Google Drive");
  }

  // 2. Gửi dữ liệu file đến Session URL vừa nhận
  let lastError: any = null;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const uploadRes = await fetch(sessionUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(bodyBytes.length)
        },
        body: new Blob([bodyBytes as any])
      });

      if (uploadRes.ok) {
        return await uploadRes.json();
      } else {
        const text = await uploadRes.text();
        throw new Error(`Google Drive Resumable PUT Error (${uploadRes.status}): ${text}`);
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[DriveAPI] Resumable PUT failed (Lần ${attempt}/${maxAttempts}): ${err.message}`);
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  }
  throw lastError;
}

async function uploadMultipart(
  filename: string,
  content: string | ArrayBuffer | Uint8Array,
  mimeType: string,
  parentId?: string,
  fileIdToUpdate?: string
) {
  const size = typeof content === 'string'
    ? new TextEncoder().encode(content).length
    : (content instanceof ArrayBuffer ? content.byteLength : content.length);

  // Nếu file lớn hơn 4.5MB, tự động dùng Resumable Upload
  if (size > 4.5 * 1024 * 1024) {
    console.log(`[DriveAPI] Dung lượng file ${size} bytes (> 4.5MB). Sử dụng Resumable upload cho ${filename}`);
    return await uploadResumable(filename, content, mimeType, parentId, fileIdToUpdate);
  }

  return await uploadMultipartRaw(filename, content, mimeType, parentId, fileIdToUpdate);
}

async function uploadMultipartRaw(
  filename: string,
  content: string | ArrayBuffer | Uint8Array,
  mimeType: string,
  parentId?: string,
  fileIdToUpdate?: string
) {
  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const metadata = {
    name: filename,
    mimeType: mimeType,
    ...(fileIdToUpdate ? {} : { parents: parentId ? [parentId] : undefined })
  };

  const encoder = new TextEncoder();
  const part1 = encoder.encode(
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n\r\n`
  );

  const part2 = typeof content === 'string'
    ? encoder.encode(content)
    : (content instanceof ArrayBuffer ? new Uint8Array(content) : content);

  const part3 = encoder.encode(close_delim);

  const body = new Blob([part1, part2 as any, part3]);

  const url = fileIdToUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileIdToUpdate}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const method = fileIdToUpdate ? "PATCH" : "POST";

  return await fetchDriveAPI(url, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
}

export async function uploadToAdminDrive(userIdentifier: string, novelName: string, content: string | ArrayBuffer | Uint8Array) {
  const userFolderId = await getUserNovelFolder(userIdentifier);
  const filename = `${novelName}.json`;
  const safeName = filename.replace(/'/g, "\\'");

  const q = encodeURIComponent(`name = '${safeName}' and '${userFolderId}' in parents and trashed = false`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);

  if (listRes.files && listRes.files.length > 0) {
    const fileId = listRes.files[0].id;
    if (listRes.files.length > 1) {
      for (let i = 1; i < listRes.files.length; i++) {
        await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${listRes.files[i].id}`, { method: 'DELETE' });
      }
    }
    await uploadMultipart(filename, content, 'application/json', undefined, fileId);
    return fileId;
  } else {
    const res = await uploadMultipart(filename, content, 'application/json', userFolderId);
    return res.id;
  }
}

export async function uploadTxtToAdminDrive(type: 'text_trung' | 'text_dich', novelName: string, content: string | ArrayBuffer | Uint8Array) {
  const folderId = await getTxtFolder(type);
  const filename = `${novelName}.txt`;
  const safeName = filename.replace(/'/g, "\\'");

  const q = encodeURIComponent(`name = '${safeName}' and '${folderId}' in parents and trashed = false`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,size)`);

  // Tính size (tương đối cho UTF-8 bằng encoder)
  const newSize = typeof content === 'string'
    ? new TextEncoder().encode(content).length
    : (content instanceof ArrayBuffer ? content.byteLength : content.length);

  if (listRes.files && listRes.files.length > 0) {
    const fileId = listRes.files[0].id;
    if (listRes.files.length > 1) {
      for (let i = 1; i < listRes.files.length; i++) {
        await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${listRes.files[i].id}`, { method: 'DELETE' });
      }
    }
    await uploadMultipart(filename, content, 'text/plain', undefined, fileId);
    return { action: 'updated', newSize };
  } else {
    await uploadMultipart(filename, content, 'text/plain', folderId);
    return { action: 'created', newSize };
  }
}

export async function listTxtFromAdminDrive(type: 'text_trung' | 'text_dich') {
  const folderId = await getTxtFolder(type);
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`);
  const res = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)`);

  const files = res.files || [];
  return files.map((f: any) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    size: f.size
  }));
}

export async function downloadFromAdminDrive(userIdentifier: string, novelName: string, raw?: boolean) {
  const userFolderId = await getUserNovelFolder(userIdentifier);
  const filename = `${novelName}.json`;
  const safeName = filename.replace(/'/g, "\\'");

  const q = encodeURIComponent(`name = '${safeName}' and '${userFolderId}' in parents and trashed = false`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);

  if (!listRes.files || listRes.files.length === 0) return null;

  const fileId = listRes.files[0].id;
  const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {}, raw);
  return content;
}

export async function downloadAllUserNovelsFromAdminDrive(userIdentifier: string): Promise<{ name: string, content: string }[]> {
  const userFolderId = await getUserNovelFolder(userIdentifier);
  const q = encodeURIComponent(`'${userFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);

  if (!listRes.files || listRes.files.length === 0) return [];

  const results: { name: string, content: string }[] = [];

  const CONCURRENCY = 5;
  for (let i = 0; i < listRes.files.length; i += CONCURRENCY) {
    const batch = listRes.files.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (file: any) => {
      try {
        const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
        let name = file.name;
        if (name.endsWith('.json')) name = name.slice(0, -5);

        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
        results.push({ name, content: contentStr });
      } catch (err) {
        console.error(`Lỗi khi tải file ${file.name}:`, err);
      }
    }));
  }

  return results;
}

export async function listUserNovelsFromAdminDrive(userIdentifier: string) {
  const userFolderId = await getUserNovelFolder(userIdentifier);
  const q = encodeURIComponent(`'${userFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`);
  const res = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)`);

  const files = res.files || [];
  return files.map((f: any) => {
    let name = f.name;
    if (name.endsWith('.json')) name = name.slice(0, -5);
    return { name, modifiedTime: f.modifiedTime, size: f.size };
  });
}

// ─── Dictionary Functions ────────────────────────────────────

let _dictCache: { timestamp: number, data: Record<string, string> } | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function uploadDictToAdminDrive(filename: string, content: string | ArrayBuffer | Uint8Array) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const dictFolderId = await findOrCreateFolder(DICT_FOLDER_NAME, masterId);

  const safeName = filename.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name = '${safeName}' and '${dictFolderId}' in parents and trashed = false`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);

  if (listRes.files && listRes.files.length > 0) {
    await uploadMultipart(filename, content, 'text/plain', undefined, listRes.files[0].id);
  } else {
    await uploadMultipart(filename, content, 'text/plain', dictFolderId);
  }

  if (_dictCache) {
    let sourceName = filename;
    if (sourceName.endsWith('.txt')) sourceName = sourceName.slice(0, -4);

    let contentStr: string;
    if (typeof content === 'string') {
      contentStr = content;
    } else {
      const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : content;
      const { decompressIfNeeded } = await import('./compression');
      contentStr = await decompressIfNeeded(bytes);
    }

    _dictCache.data[sourceName] = contentStr;
    _dictCache.timestamp = Date.now();
  }
}

export async function downloadDictFromAdminDrive(filename: string, raw?: boolean) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const dictFolderId = await findOrCreateFolder(DICT_FOLDER_NAME, masterId);

  const safeName = filename.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name = '${safeName}' and '${dictFolderId}' in parents and trashed = false`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);

  if (!listRes.files || listRes.files.length === 0) return null;
  const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${listRes.files[0].id}?alt=media`, {}, raw);
  return content;
}

export async function downloadAllDictsFromAdminDrive(): Promise<Record<string, string>> {
  if (_dictCache && Date.now() - _dictCache.timestamp < CACHE_TTL) {
    return _dictCache.data;
  }

  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const dictFolderId = await findOrCreateFolder(DICT_FOLDER_NAME, masterId);

  const q = encodeURIComponent(`'${dictFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);

  const files = listRes.files || [];
  if (files.length === 0) return {};

  const results: Record<string, string> = {};

  // Concurrency limit to prevent rate limits
  const CONCURRENCY = 5;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (file: any) => {
      try {
        const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
        let sourceName = file.name;
        if (sourceName.endsWith('.txt')) sourceName = sourceName.slice(0, -4);
        results[sourceName] = contentStr;
      } catch (err) {
        console.error(`Error downloading dict ${file.name}:`, err);
      }
    }));
  }

  _dictCache = { timestamp: Date.now(), data: results };
  return results;
}

// ─── Community Dictionary Functions ────────────────────────

export async function uploadCommunityDictToAdminDrive(genre: string, filename: string, content: string) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const commDictFolderId = await findOrCreateFolder(COMMUNITY_DICT_FOLDER_NAME, masterId);
  const genreFolderId = await findOrCreateFolder(genre, commDictFolderId);

  // Dùng Unix Timestamp để không bị đè file nếu nhiều người cùng upload
  const uniqueFilename = `${filename}_${Date.now()}.txt`;
  await uploadMultipart(uniqueFilename, content, 'text/plain', genreFolderId);
}

export async function listCommunityDictsFromAdminDrive() {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const commDictFolderId = await findOrCreateFolder(COMMUNITY_DICT_FOLDER_NAME, masterId);

  const q1 = encodeURIComponent(`'${commDictFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const genreRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q1}&fields=files(id,name)`);

  const genres = genreRes.files || [];
  const results: { id: string, name: string, genre: string, createdTime: string }[] = [];

  for (const genreFolder of genres) {
    const q2 = encodeURIComponent(`'${genreFolder.id}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`);
    const fileRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q2}&fields=files(id,name,createdTime)&orderBy=createdTime desc`);

    const files = fileRes.files || [];
    for (const file of files) {
      results.push({
        id: file.id,
        name: file.name,
        genre: genreFolder.name,
        createdTime: file.createdTime,
      });
    }
  }

  results.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
  return results;
}

export async function downloadAllCommunityDictsFromAdminDrive(): Promise<Record<string, string>> {
  const files = await listCommunityDictsFromAdminDrive();
  const results: Record<string, string[]> = {};

  const CONCURRENCY = 5;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (file) => {
      try {
        const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
        
        if (!results[file.genre]) results[file.genre] = [];
        results[file.genre].push(contentStr);
      } catch (err) {
        console.error(`Error downloading community dict file ${file.name}:`, err);
      }
    }));
  }

  // Gộp tất cả các file của cùng 1 thể loại thành 1 string lớn cách nhau bằng \n
  const finalResults: Record<string, string> = {};
  for (const [genre, contents] of Object.entries(results)) {
    finalResults[genre] = contents.join('\n');
  }

  return finalResults;
}

export async function getDriveFileContent(fileId: string, raw?: boolean) {
  const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {}, raw);
  if (raw) return content as Uint8Array;
  return typeof content === 'string' ? content : JSON.stringify(content);
}

export async function deleteDriveFile(fileId: string) {
  await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
}

// ─── Bot Queue Functions ────────────────────────────────────

export async function uploadBotQueueFile(filename: string, content: string) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const botQueueFolderId = await findOrCreateFolder(BOT_QUEUE_FOLDER_NAME, masterId);

  const safeName = filename.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name = '${safeName}' and '${botQueueFolderId}' in parents and trashed = false`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);

  if (listRes.files && listRes.files.length > 0) {
    const fileId = listRes.files[0].id;
    await uploadMultipart(filename, content, 'application/json', undefined, fileId);
    return fileId;
  } else {
    const res = await uploadMultipart(filename, content, 'application/json', botQueueFolderId);
    return res.id;
  }
}

export async function downloadBotQueueFile(fileId: string) {
  const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return typeof content === 'string' ? content : JSON.stringify(content);
}

// ─── Reading Room (Phòng Đọc) Functions ────────────────────────

export interface ReadingRoomMetadata {
  id: string; // novel ID or unique string
  title: string;
  author: string;
  description: string;
  coverImage: string;
  chapterCount: number;
  uploaderName: string;
  uploaderId?: string;
  genres?: string[]; // Bổ sung thể loại
  updatedAt: number;
  driveFileId?: string; // Cache Google Drive file ID of the novel data file
  viewsCount?: number;
  reviewCount?: number;
  wrongChaptersCount?: number;
}

let _readingRoomIndexCache: { timestamp: number, data: ReadingRoomMetadata[] } | null = null;
const INDEX_CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache TTL

export async function getReadingRoomIndex(): Promise<ReadingRoomMetadata[]> {
  if (_readingRoomIndexCache && Date.now() - _readingRoomIndexCache.timestamp < INDEX_CACHE_TTL) {
    return _readingRoomIndexCache.data;
  }

  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  let fileId = cachedIndexFileId;
  if (!fileId) {
    const safeName = 'index.json';
    const q = encodeURIComponent(`name = '${safeName}' and '${readingRoomId}' in parents and trashed = false`);
    const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
    if (listRes.files && listRes.files.length > 0) {
      fileId = listRes.files[0].id;
      cachedIndexFileId = fileId;
    }
  }

  if (!fileId) return [];

  try {
    const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    const data = JSON.parse(str) as ReadingRoomMetadata[];
    _readingRoomIndexCache = { timestamp: Date.now(), data };
    return data;
  } catch (err) {
    console.error("Lỗi khi parse file index.json của Phòng Đọc:", err);
    return [];
  }
}

export async function uploadToReadingRoom(
  novelId: string,
  metadata: ReadingRoomMetadata,
  fullData: string | ArrayBuffer | Uint8Array
) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  // 1. Upload Data File
  const dataFilename = `${novelId}_data.json`;
  let dataFileId: string | undefined = undefined;

  // Lấy dữ liệu file ID từ index cache trước để tránh gọi API search của Drive
  const currentIndex = await getReadingRoomIndex();
  const existingNovelMeta = currentIndex.find(n => n.id === novelId);
  if (existingNovelMeta && existingNovelMeta.driveFileId) {
    dataFileId = existingNovelMeta.driveFileId;
  }

  // Nếu không thấy trong index cache, thực hiện search query trên Drive
  if (!dataFileId) {
    const safeDataName = dataFilename.replace(/'/g, "\\'");
    const qData = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
    const listDataRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qData}&fields=files(id)`);
    if (listDataRes.files && listDataRes.files.length > 0) {
      dataFileId = listDataRes.files[0].id;
    }
  }

  if (dataFileId) {
    await uploadMultipart(dataFilename, fullData, 'application/json', undefined, dataFileId);
  } else {
    const res = await uploadMultipart(dataFilename, fullData, 'application/json', readingRoomId);
    dataFileId = res.id;
  }

  // 2. Update Index File (Đồng bộ hóa ghi sử dụng Mutex tuần tự để tránh xung đột ghi/ghi đè mất data)
  await readingRoomIndexMutex.runExclusive(async () => {
    const indexFilename = 'index.json';
    let indexFileId = cachedIndexFileId;
    let currentList: ReadingRoomMetadata[] = [];

    if (!indexFileId) {
      const qIndex = encodeURIComponent(`name = '${indexFilename}' and '${readingRoomId}' in parents and trashed = false`);
      const listIndexRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qIndex}&fields=files(id)`);
      if (listIndexRes.files && listIndexRes.files.length > 0) {
        indexFileId = listIndexRes.files[0].id;
        cachedIndexFileId = indexFileId;
      }
    }

    if (indexFileId) {
      try {
        const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${indexFileId}?alt=media`);
        const str = typeof content === 'string' ? content : JSON.stringify(content);
        currentList = JSON.parse(str);
      } catch {
        currentList = [];
      }
    }

    // Gắn driveFileId vào metadata để các lượt cập nhật sau ko cần query tìm file
    metadata.driveFileId = dataFileId;

    const existingIndex = currentList.findIndex(x => x.id === novelId);
    if (existingIndex >= 0) {
      currentList[existingIndex] = metadata;
    } else {
      currentList.push(metadata);
    }

    // Sắp xếp theo ngày cập nhật giảm dần
    currentList.sort((a, b) => b.updatedAt - a.updatedAt);
    const indexStr = JSON.stringify(currentList, null, 2);

    if (indexFileId) {
      await uploadMultipart(indexFilename, indexStr, 'application/json', undefined, indexFileId);
    } else {
      const res = await uploadMultipart(indexFilename, indexStr, 'application/json', readingRoomId);
      if (res && res.id) {
        cachedIndexFileId = res.id;
      }
    }
    _readingRoomIndexCache = { timestamp: Date.now(), data: currentList }; // Cập nhật cache trực tiếp
  });
}

export async function editMetadataInReadingRoom(
  novelId: string,
  newTitle: string,
  newDescription: string | undefined,
  userId: string,
  newGenres?: string[],
  isAdminOverride?: boolean,
  newWrongChaptersCount?: number,
  newReviewIssues?: any[]
) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  // 1. Check and Update Index File (Đồng bộ hóa ghi sử dụng Mutex tuần tự)
  const indexFilename = 'index.json';
  let indexFileId = cachedIndexFileId;
  let currentList: ReadingRoomMetadata[] = [];

  await readingRoomIndexMutex.runExclusive(async () => {
    if (!indexFileId) {
      const qIndex = encodeURIComponent(`name = '${indexFilename}' and '${readingRoomId}' in parents and trashed = false`);
      const listIndexRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qIndex}&fields=files(id)`);
      if (!listIndexRes.files || listIndexRes.files.length === 0) {
        throw new Error("Index file not found");
      }
      indexFileId = listIndexRes.files[0].id;
      cachedIndexFileId = indexFileId;
    }

    const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${indexFileId}?alt=media`);
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    currentList = JSON.parse(str);

    const novelIndex = currentList.findIndex(x => x.id === novelId);
    if (novelIndex < 0) throw new Error("Novel not found in Room");

    const novel = currentList[novelIndex];
    if (!isAdminOverride && novel.uploaderId !== userId && novel.uploaderId) {
      throw new Error("Unauthorized: Bạn không phải người đăng gốc của bộ truyện này.");
    }

    if (newTitle) novel.title = newTitle;
    if (newDescription !== undefined) novel.description = newDescription;
    if (newGenres !== undefined) novel.genres = newGenres;
    if (newWrongChaptersCount !== undefined) novel.wrongChaptersCount = newWrongChaptersCount;
    novel.updatedAt = Date.now();

    const indexStr = JSON.stringify(currentList, null, 2);
    await uploadMultipart(indexFilename, indexStr, 'application/json', undefined, indexFileId);
    _readingRoomIndexCache = { timestamp: Date.now(), data: currentList };
  });

  // 2. Update Data File
  const dataFilename = `${novelId}_data.json`;
  let dataId: string | undefined = undefined;

  const novel = currentList.find(x => x.id === novelId);
  if (novel && novel.driveFileId) {
    dataId = novel.driveFileId;
  }

  if (!dataId) {
    const safeDataName = dataFilename.replace(/'/g, "\\'");
    const qData = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
    const listDataRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qData}&fields=files(id)`);
    if (listDataRes.files && listDataRes.files.length > 0) {
      dataId = listDataRes.files[0].id;
    }
  }

  if (dataId) {
    const dataContent = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${dataId}?alt=media`);
    const dataStr = typeof dataContent === 'string' ? dataContent : JSON.stringify(dataContent);
    const parsedData = JSON.parse(dataStr);

    if (newTitle) {
      if (parsedData.title !== undefined) parsedData.title = newTitle;
      if (parsedData.novel?.title !== undefined) parsedData.novel.title = newTitle;
    }
    if (newDescription !== undefined) {
      if (parsedData.description !== undefined) parsedData.description = newDescription;
      if (parsedData.novel?.description !== undefined) parsedData.novel.description = newDescription;
    }
    if (newGenres !== undefined) {
      if (parsedData.genres !== undefined) parsedData.genres = newGenres;
      if (parsedData.novel?.genres !== undefined) parsedData.novel.genres = newGenres;
    }
    if (newWrongChaptersCount !== undefined) {
      if (parsedData.wrongChaptersCount !== undefined) parsedData.wrongChaptersCount = newWrongChaptersCount;
      if (parsedData.novel !== undefined) {
        parsedData.novel.wrongChaptersCount = newWrongChaptersCount;
      }
    }
    if (newReviewIssues !== undefined) {
      if (parsedData.reviewIssues !== undefined) parsedData.reviewIssues = newReviewIssues;
      if (parsedData.novel !== undefined) {
        parsedData.novel.reviewIssues = newReviewIssues;
      }
    }

    await uploadMultipart(dataFilename, JSON.stringify(parsedData), 'application/json', undefined, dataId);
  }
}

export async function toggleChapterLockInReadingRoom(novelId: string, chapterIdx: number, userId: string) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  // Check Uploader ID via Index
  const currentList = await getReadingRoomIndex();
  const novel = currentList.find(x => x.id === novelId);
  if (!novel) throw new Error("Novel not found in Room");
  if (novel.uploaderId !== userId && novel.uploaderId) {
    throw new Error("Unauthorized: Bạn không phải tác giả của bộ truyện này.");
  }

  // Update Data File
  const dataFilename = `${novelId}_data.json`;
  let dataId: string | undefined = novel.driveFileId;

  if (!dataId) {
    const safeDataName = dataFilename.replace(/'/g, "\\'");
    const qData = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
    const listDataRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qData}&fields=files(id)`);
    if (!listDataRes.files || listDataRes.files.length === 0) throw new Error("Data file not found");
    dataId = listDataRes.files[0].id;
  }

  const dataContent = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${dataId}?alt=media`);
  const dataStr = typeof dataContent === 'string' ? dataContent : JSON.stringify(dataContent);
  const parsedData = JSON.parse(dataStr);

  const sortedChapters = parsedData.chapters?.sort((a: any, b: any) => a.order - b.order) || [];
  if (chapterIdx < 0 || chapterIdx >= sortedChapters.length) throw new Error("Chapter index OOB");

  const ch = sortedChapters[chapterIdx];
  ch.isLocked = !ch.isLocked;

  await uploadMultipart(dataFilename, JSON.stringify(parsedData), 'application/json', undefined, dataId);
  _readingRoomIndexCache = null; // Invalidate cache
  return ch.isLocked;
}

export async function downloadNovelFromReadingRoom(novelId: string, raw?: boolean): Promise<any> {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  const dataFilename = `${novelId}_data.json`;
  const safeDataName = dataFilename.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);

  if (!listRes.files || listRes.files.length === 0) return null;

  const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${listRes.files[0].id}?alt=media`, {}, raw);
  if (raw) return content;
  return typeof content === 'string' ? content : JSON.stringify(content);
}

export async function deleteFromReadingRoom(novelId: string) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  // 1. Delete data file
  let dataId: string | undefined = undefined;
  const currentList = await getReadingRoomIndex();
  const novel = currentList.find(x => x.id === novelId);
  if (novel && novel.driveFileId) {
    dataId = novel.driveFileId;
  }

  if (!dataId) {
    const dataFilename = `${novelId}_data.json`;
    const safeDataName = dataFilename.replace(/'/g, "\\'");
    const qData = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
    const dataRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qData}&fields=files(id)`);
    if (dataRes.files && dataRes.files.length > 0) {
      dataId = dataRes.files[0].id;
    }
  }

  if (dataId) {
    await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${dataId}`, { method: 'DELETE' }).catch(e => console.error(e));
  }

  // 2. Remove from index (Đồng bộ hóa ghi sử dụng Mutex tuần tự)
  await readingRoomIndexMutex.runExclusive(async () => {
    const indexFilename = 'index.json';
    let indexFileId = cachedIndexFileId;

    if (!indexFileId) {
      const qIndex = encodeURIComponent(`name = '${indexFilename}' and '${readingRoomId}' in parents and trashed = false`);
      const indexRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qIndex}&fields=files(id)`);
      if (indexRes.files && indexRes.files.length > 0) {
        indexFileId = indexRes.files[0].id;
        cachedIndexFileId = indexFileId;
      }
    }

    if (indexFileId) {
      const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${indexFileId}?alt=media`);
      const str = typeof content === 'string' ? content : JSON.stringify(content);
      const indexData = JSON.parse(str) as ReadingRoomMetadata[];

      const filteredData = indexData.filter(n => n.id !== novelId);
      await uploadMultipart(indexFilename, JSON.stringify(filteredData), 'application/json', undefined, indexFileId);
      _readingRoomIndexCache = { timestamp: Date.now(), data: filteredData }; // Cập nhật cache trực tiếp
    }
  });
}

export async function initResumableUpload(novelId: string, totalSize: number): Promise<string> {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  const dataFilename = `${novelId}_data.json`;
  let dataFileId: string | undefined = undefined;

  const currentIndex = await getReadingRoomIndex().catch(() => []);
  const existingNovelMeta = currentIndex.find(n => n.id === novelId);
  if (existingNovelMeta && existingNovelMeta.driveFileId) {
    dataFileId = existingNovelMeta.driveFileId;
  }

  if (!dataFileId) {
    const safeDataName = dataFilename.replace(/'/g, "\\'");
    const qData = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
    const listDataRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qData}&fields=files(id)`);
    if (listDataRes.files && listDataRes.files.length > 0) {
      dataFileId = listDataRes.files[0].id;
    }
  }

  const metadata = {
    name: dataFilename,
    mimeType: 'application/json',
    ...(dataFileId ? {} : { parents: [readingRoomId] })
  };

  const initUrl = dataFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${dataFileId}?uploadType=resumable`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
  const initMethod = dataFileId ? "PATCH" : "POST";

  const token = await getAccessToken();
  const initRes = await fetch(initUrl, {
    method: initMethod,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/json',
      'X-Upload-Content-Length': String(totalSize)
    },
    body: JSON.stringify(metadata)
  });

  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`Google Drive Resumable Init Error (${initRes.status}): ${text}`);
  }

  const sessionUrl = initRes.headers.get('Location');
  if (!sessionUrl) {
    throw new Error("Không nhận được session URL (Location header) từ Google Drive");
  }
  return sessionUrl;
}

export async function uploadResumableChunk(
  sessionUrl: string,
  chunkBytes: Uint8Array,
  contentRange: string
): Promise<{ status: number; text: string }> {
  const res = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      'Content-Range': contentRange,
      'Content-Length': String(chunkBytes.length)
    },
    body: chunkBytes as any
  });

  const text = await res.text();
  return { status: res.status, text };
}

export async function checkResumableUploadStatus(
  sessionUrl: string,
  totalSize: number
): Promise<{ completed: boolean; fileId?: string; range?: string | null }> {
  const res = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      'Content-Range': `bytes */${totalSize}`
    }
  });

  if (res.status === 200 || res.status === 201) {
    const data = await res.json();
    return { completed: true, fileId: data.id };
  } else if (res.status === 308) {
    const range = res.headers.get('Range');
    return { completed: false, range };
  } else {
    const text = await res.text();
    throw new Error(`Google Drive Resumable Check Status Error (${res.status}): ${text}`);
  }
}

export async function updateReadingRoomIndex(
  novelId: string,
  metadata: ReadingRoomMetadata,
  dataFileId: string
): Promise<void> {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  await readingRoomIndexMutex.runExclusive(async () => {
    const indexFilename = 'index.json';
    let indexFileId = cachedIndexFileId;
    let currentList: ReadingRoomMetadata[] = [];

    if (!indexFileId) {
      const qIndex = encodeURIComponent(`name = '${indexFilename}' and '${readingRoomId}' in parents and trashed = false`);
      const listIndexRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qIndex}&fields=files(id)`);
      if (listIndexRes.files && listIndexRes.files.length > 0) {
        indexFileId = listIndexRes.files[0].id;
        cachedIndexFileId = indexFileId;
      }
    }

    if (indexFileId) {
      try {
        const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${indexFileId}?alt=media`);
        const str = typeof content === 'string' ? content : JSON.stringify(content);
        currentList = JSON.parse(str);
      } catch {
        currentList = [];
      }
    }

    metadata.driveFileId = dataFileId;
    metadata.updatedAt = Date.now();

    const existingIndex = currentList.findIndex(x => x.id === novelId);
    if (existingIndex >= 0) {
      currentList[existingIndex] = metadata;
    } else {
      currentList.push(metadata);
    }

    currentList.sort((a, b) => b.updatedAt - a.updatedAt);
    const indexStr = JSON.stringify(currentList, null, 2);

    if (indexFileId) {
      await uploadMultipart(indexFilename, indexStr, 'application/json', undefined, indexFileId);
    } else {
      const res = await uploadMultipart(indexFilename, indexStr, 'application/json', readingRoomId);
      if (res && res.id) {
        cachedIndexFileId = res.id;
      }
    }
    _readingRoomIndexCache = { timestamp: Date.now(), data: currentList };
  });
}


