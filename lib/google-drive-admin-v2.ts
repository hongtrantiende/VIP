let cachedToken: string | null = null;
let tokenExpiryTime: number = 0;

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
  const maxRetries = 3;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const token = await getAccessToken();
      const headers = new Headers(options.headers || {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const res = await fetch(url, { cache: 'no-store', ...options, headers });
      if (!res.ok) {
        const isRetryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
        if (isRetryable && attempt < maxRetries) {
          const delayMs = attempt * 2000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        const text = await res.text();
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
      return res.json();
    } catch (err) {
      if (attempt < maxRetries) {
        const delayMs = attempt * 2000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
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
  setTimeout(() => { delete folderCache[cacheKey]; }, 60000);

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
async function uploadMultipart(
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
}

let _readingRoomIndexCache: { timestamp: number, data: ReadingRoomMetadata[] } | null = null;
const INDEX_CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache TTL

export async function getReadingRoomIndex(): Promise<ReadingRoomMetadata[]> {
  if (_readingRoomIndexCache && Date.now() - _readingRoomIndexCache.timestamp < INDEX_CACHE_TTL) {
    return _readingRoomIndexCache.data;
  }

  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  const safeName = 'index.json';
  const q = encodeURIComponent(`name = '${safeName}' and '${readingRoomId}' in parents and trashed = false`);
  const listRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);

  if (!listRes.files || listRes.files.length === 0) return [];
  const fileId = listRes.files[0].id;

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
  const safeDataName = dataFilename.replace(/'/g, "\\'");
  const qData = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
  const listDataRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qData}&fields=files(id)`);

  if (listDataRes.files && listDataRes.files.length > 0) {
    await uploadMultipart(dataFilename, fullData, 'application/json', undefined, listDataRes.files[0].id);
  } else {
    await uploadMultipart(dataFilename, fullData, 'application/json', readingRoomId);
  }

  // 2. Update Index File
  const indexFilename = 'index.json';
  const qIndex = encodeURIComponent(`name = '${indexFilename}' and '${readingRoomId}' in parents and trashed = false`);
  const listIndexRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qIndex}&fields=files(id)`);

  let currentList: ReadingRoomMetadata[] = [];
  let indexFileId = undefined;

  if (listIndexRes.files && listIndexRes.files.length > 0) {
    indexFileId = listIndexRes.files[0].id;
    try {
      const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${indexFileId}?alt=media`);
      const str = typeof content === 'string' ? content : JSON.stringify(content);
      currentList = JSON.parse(str);
    } catch {
      currentList = [];
    }
  }

  const existingIndex = currentList.findIndex(x => x.id === novelId);
  if (existingIndex >= 0) {
    currentList[existingIndex] = metadata;
  } else {
    currentList.push(metadata);
  }

  // Sort by update time desc
  currentList.sort((a, b) => b.updatedAt - a.updatedAt);
  const indexStr = JSON.stringify(currentList, null, 2);

  if (indexFileId) {
    await uploadMultipart(indexFilename, indexStr, 'application/json', undefined, indexFileId);
  } else {
    await uploadMultipart(indexFilename, indexStr, 'application/json', readingRoomId);
  }
  _readingRoomIndexCache = null; // Invalidate cache
}

export async function editMetadataInReadingRoom(
  novelId: string,
  newTitle: string,
  newDescription: string | undefined,
  userId: string,
  newGenres?: string[],
  isAdminOverride?: boolean
) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  // 1. Check and Update Index File
  const indexFilename = 'index.json';
  const qIndex = encodeURIComponent(`name = '${indexFilename}' and '${readingRoomId}' in parents and trashed = false`);
  const listIndexRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qIndex}&fields=files(id)`);

  if (!listIndexRes.files || listIndexRes.files.length === 0) {
    throw new Error("Index file not found");
  }

  const indexFileId = listIndexRes.files[0].id;
  const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${indexFileId}?alt=media`);
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  const currentList: ReadingRoomMetadata[] = JSON.parse(str);

  const novelIndex = currentList.findIndex(x => x.id === novelId);
  if (novelIndex < 0) throw new Error("Novel not found in Room");

  const novel = currentList[novelIndex];
  if (!isAdminOverride && novel.uploaderId !== userId && novel.uploaderId) {
    // If it has uploaderId and doesn't match, block it.
    throw new Error("Unauthorized: Bạn không phải người đăng gốc của bộ truyện này.");
  }

  if (newTitle) novel.title = newTitle;
  if (newDescription !== undefined) novel.description = newDescription;
  if (newGenres !== undefined) novel.genres = newGenres;
  novel.updatedAt = Date.now();

  const indexStr = JSON.stringify(currentList, null, 2);
  await uploadMultipart(indexFilename, indexStr, 'application/json', undefined, indexFileId);
  _readingRoomIndexCache = null; // Invalidate cache

  // 2. Update Data File
  const dataFilename = `${novelId}_data.json`;
  const safeDataName = dataFilename.replace(/'/g, "\\'");
  const qData = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
  const listDataRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qData}&fields=files(id)`);

  if (listDataRes.files && listDataRes.files.length > 0) {
    const dataId = listDataRes.files[0].id;
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

    await uploadMultipart(dataFilename, JSON.stringify(parsedData), 'application/json', undefined, dataId);
  }
}

export async function toggleChapterLockInReadingRoom(novelId: string, chapterIdx: number, userId: string) {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const readingRoomId = await findOrCreateFolder(READING_ROOM_FOLDER_NAME, masterId);

  // Check Uploader ID via Index
  const indexFilename = 'index.json';
  const qIndex = encodeURIComponent(`name = '${indexFilename}' and '${readingRoomId}' in parents and trashed = false`);
  const listIndexRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qIndex}&fields=files(id)`);
  if (!listIndexRes.files || listIndexRes.files.length === 0) throw new Error("Index file not found");

  const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${listIndexRes.files[0].id}?alt=media`);
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  const currentList: ReadingRoomMetadata[] = JSON.parse(str);

  const novelIndex = currentList.findIndex(x => x.id === novelId);
  if (novelIndex < 0) throw new Error("Novel not found in Room");
  const novel = currentList[novelIndex];
  if (novel.uploaderId !== userId && novel.uploaderId) {
    throw new Error("Unauthorized: Bạn không phải tác giả của bộ truyện này.");
  }

  // Update Data File
  const dataFilename = `${novelId}_data.json`;
  const safeDataName = dataFilename.replace(/'/g, "\\'");
  const qData = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
  const listDataRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qData}&fields=files(id)`);
  if (!listDataRes.files || listDataRes.files.length === 0) throw new Error("Data file not found");

  const dataId = listDataRes.files[0].id;
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
  const dataFilename = `${novelId}_data.json`;
  const safeDataName = dataFilename.replace(/'/g, "\\'");
  const qData = encodeURIComponent(`name = '${safeDataName}' and '${readingRoomId}' in parents and trashed = false`);
  const dataRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qData}&fields=files(id)`);
  if (dataRes.files && dataRes.files.length > 0) {
    await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${dataRes.files[0].id}`, { method: 'DELETE' }).catch(e => console.error(e));
  }

  // 2. Remove from index
  const safeName = 'index.json';
  const qIndex = encodeURIComponent(`name = '${safeName}' and '${readingRoomId}' in parents and trashed = false`);
  const indexRes = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files?q=${qIndex}&fields=files(id)`);

  if (indexRes.files && indexRes.files.length > 0) {
    const fileId = indexRes.files[0].id;
    const content = await fetchDriveAPI(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    let indexData = JSON.parse(str) as ReadingRoomMetadata[];

    indexData = indexData.filter(n => n.id !== novelId);
    await uploadMultipart('index.json', JSON.stringify(indexData), 'application/json', undefined, fileId);
    _readingRoomIndexCache = null; // Invalidate cache
  }
}

