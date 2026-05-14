import { google } from 'googleapis';
import { PassThrough } from 'stream';

function stringToStream(content: string) {
  const stream = new PassThrough();
  stream.end(Buffer.from(content, 'utf-8'));
  return stream;
}

function getDriveClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost'
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

const MASTER_FOLDER_NAME = 'Kho_chua_du_lieu_App';
const DICT_FOLDER_NAME = 'Tu_dien';
const NOVEL_ROOT_FOLDER_NAME = 'Truyen_nguoi_dung';
const TXT_ROOT_FOLDER_NAME = 'Kho_van_ban_TXT';
const COMMUNITY_DICT_FOLDER_NAME = 'Tu_dien_cong_dong';

// Bộ nhớ đệm để tránh tạo trùng thư mục khi chạy song song
const folderCache: Record<string, Promise<string>> = {};

/** Find or create a folder by name under a parent (Race-condition safe) */
async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const cacheKey = `${parentId || 'root'}_${name}`;
  
  if (cacheKey in folderCache) {
    return folderCache[cacheKey];
  }

  const createPromise = (async () => {
    const googleDriveClient = getDriveClient();
    const q = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${
      parentId ? ` and '${parentId}' in parents` : ''
    }`;

    // 1. Thử tìm xem đã có chưa
    const res = await googleDriveClient.files.list({
      q,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id!;
    }

    // 2. Nếu chưa có, tiến hành tạo mới
    try {
      const createRes = await googleDriveClient.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: parentId ? [parentId] : undefined,
        },
        fields: 'id',
      });
      return createRes.data.id!;
    } catch (err: any) {
      // Nếu lỗi do tranh chấp (ai đó vừa tạo xong), thử tìm lại lần cuối
      const retryRes = await googleDriveClient.files.list({ q, fields: 'files(id)' });
      if (retryRes.data.files && retryRes.data.files.length > 0) {
        return retryRes.data.files[0].id!;
      }
      throw err;
    }
  })();

  folderCache[cacheKey] = createPromise;
  
  // Sau 1 phút thì xóa cache để đảm bảo dữ liệu mới nhất nếu folder bị xóa tay trên Drive
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

export async function uploadToAdminDrive(userIdentifier: string, novelName: string, content: string) {
  const googleDriveClient = getDriveClient();
  const userFolderId = await getUserNovelFolder(userIdentifier);

  const filename = `${novelName}.json`;
  const q = `name = '${filename}' and '${userFolderId}' in parents and trashed = false`;
  const listRes = await googleDriveClient.files.list({ q, fields: 'files(id)' });

  if (listRes.data.files && listRes.data.files.length > 0) {
    const fileId = listRes.data.files[0].id!;
    
    // Nếu có nhiều file trùng tên, xóa các file thừa
    if (listRes.data.files.length > 1) {
      for (let i = 1; i < listRes.data.files.length; i++) {
        await googleDriveClient.files.delete({ fileId: listRes.data.files[i].id! });
      }
    }

    await googleDriveClient.files.update({
      fileId,
      media: { mimeType: 'application/json', body: stringToStream(content) },
    });
    return fileId;
  } else {
    const createRes = await googleDriveClient.files.create({
      requestBody: { name: filename, parents: [userFolderId], mimeType: 'application/json' },
      media: { mimeType: 'application/json', body: stringToStream(content) },
      fields: 'id',
    });
    return createRes.data.id;
  }
}

export async function uploadTxtToAdminDrive(type: 'text_trung' | 'text_dich', novelName: string, content: string) {
  const googleDriveClient = getDriveClient();
  const folderId = await getTxtFolder(type);

  const filename = `${novelName}.txt`;
  const q = `name = '${filename}' and '${folderId}' in parents and trashed = false`;
  const listRes = await googleDriveClient.files.list({ q, fields: 'files(id, size)' });

  const newSize = Buffer.byteLength(content, 'utf8');

  if (listRes.data.files && listRes.data.files.length > 0) {
    const file = listRes.data.files[0];
    
    // Xóa các file thừa nếu có tình trạng trùng tên
    if (listRes.data.files.length > 1) {
      for (let i = 1; i < listRes.data.files.length; i++) {
        await googleDriveClient.files.delete({ fileId: listRes.data.files[i].id! });
      }
    }

    // Luôn luôn ghi đè file cũ bằng file mới nhất
    await googleDriveClient.files.update({
      fileId: file.id!,
      media: { mimeType: 'text/plain', body: stringToStream(content) },
    });
    return { action: 'updated', newSize };
  } else {
    await googleDriveClient.files.create({
      requestBody: { name: filename, parents: [folderId], mimeType: 'text/plain' },
      media: { mimeType: 'text/plain', body: stringToStream(content) },
    });
    return { action: 'created', newSize };
  }
}

export async function listTxtFromAdminDrive(type: 'text_trung' | 'text_dich') {
  const googleDriveClient = getDriveClient();
  const folderId = await getTxtFolder(type);

  const res = await googleDriveClient.files.list({
    q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, modifiedTime, size)',
  });

  const files = res.data.files || [];
  return files.map(f => ({
    id: f.id!,
    name: f.name!,
    modifiedTime: f.modifiedTime,
    size: f.size
  }));
}

export async function downloadFromAdminDrive(userIdentifier: string, novelName: string): Promise<string | null> {
  const googleDriveClient = getDriveClient();
  const userFolderId = await getUserNovelFolder(userIdentifier);

  const filename = `${novelName}.json`;
  const q = `name = '${filename}' and '${userFolderId}' in parents and trashed = false`;
  const listRes = await googleDriveClient.files.list({ q, fields: 'files(id)' });

  if (!listRes.data.files || listRes.data.files.length === 0) return null;

  const fileId = listRes.data.files[0].id!;
  const res = await googleDriveClient.files.get({
    fileId,
    alt: 'media',
  });

  return res.data as string;
}

export async function downloadAllUserNovelsFromAdminDrive(userIdentifier: string): Promise<{ name: string, content: string }[]> {
  const googleDriveClient = getDriveClient();
  const userFolderId = await getUserNovelFolder(userIdentifier);

  const q = `'${userFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
  const listRes = await googleDriveClient.files.list({ q, fields: 'files(id, name)' });

  if (!listRes.data.files || listRes.data.files.length === 0) return [];

  const results: { name: string, content: string }[] = [];
  
  // Tải về tất cả file JSON (có thể chạy song song hoặc tuần tự, ở đây chạy tuần tự để tránh rate limit)
  for (const file of listRes.data.files) {
    try {
      const res = await googleDriveClient.files.get({
        fileId: file.id!,
        alt: 'media',
      });
      // Bỏ đi đuôi .json để lấy tên truyện gốc nếu muốn, hoặc trả về nguyên name
      let name = file.name!;
      if (name.endsWith('.json')) name = name.slice(0, -5);
      
      // Xử lý cả dạng string lẫn object trả về từ google api
      const contentStr = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      results.push({ name, content: contentStr });
    } catch (err) {
      console.error(`Lỗi khi tải file ${file.name}:`, err);
    }
  }

  return results;
}

export async function listUserNovelsFromAdminDrive(userIdentifier: string) {
    const googleDriveClient = getDriveClient();
    const userFolderId = await getUserNovelFolder(userIdentifier);
  
    const res = await googleDriveClient.files.list({
      q: `'${userFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, modifiedTime, size)',
    });
  
    const files = res.data.files || [];
    // Convert .json files to novel names
    return files.map(f => {
      let name = f.name!;
      if (name.endsWith('.json')) name = name.slice(0, -5);
      return { name, modifiedTime: f.modifiedTime, size: f.size };
    });
}

// ─── Dictionary Functions ────────────────────────────────────

let _dictCache: { timestamp: number, data: Record<string, string> } | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function uploadDictToAdminDrive(filename: string, content: string) {
    const googleDriveClient = getDriveClient();
    const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
    const dictFolderId = await findOrCreateFolder(DICT_FOLDER_NAME, masterId);

    const q = `name = '${filename}' and '${dictFolderId}' in parents and trashed = false`;
    const listRes = await googleDriveClient.files.list({ q, fields: 'files(id)' });

    if (listRes.data.files && listRes.data.files.length > 0) {
        await googleDriveClient.files.update({
            fileId: listRes.data.files[0].id!,
            media: { mimeType: 'text/plain', body: stringToStream(content) },
        });
    } else {
        await googleDriveClient.files.create({
            requestBody: { name: filename, parents: [dictFolderId], mimeType: 'text/plain' },
            media: { mimeType: 'text/plain', body: stringToStream(content) },
        });
    }

    if (_dictCache) {
        let sourceName = filename;
        if (sourceName.endsWith('.txt')) sourceName = sourceName.slice(0, -4);
        _dictCache.data[sourceName] = content;
        _dictCache.timestamp = Date.now();
    }
}

export async function downloadDictFromAdminDrive(filename: string) {
    const googleDriveClient = getDriveClient();
    const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
    const dictFolderId = await findOrCreateFolder(DICT_FOLDER_NAME, masterId);

    const q = `name = '${filename}' and '${dictFolderId}' in parents and trashed = false`;
    const listRes = await googleDriveClient.files.list({ q, fields: 'files(id)' });

    if (!listRes.data.files || listRes.data.files.length === 0) return null;

    const res = await googleDriveClient.files.get({
        fileId: listRes.data.files[0].id!,
        alt: 'media',
    });
    return res.data as string;
}

export async function downloadAllDictsFromAdminDrive(): Promise<Record<string, string>> {
    if (_dictCache && Date.now() - _dictCache.timestamp < CACHE_TTL) {
        return _dictCache.data;
    }

    const googleDriveClient = getDriveClient();
    const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
    const dictFolderId = await findOrCreateFolder(DICT_FOLDER_NAME, masterId);

    const q = `'${dictFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const listRes = await googleDriveClient.files.list({ q, fields: 'files(id, name)' });

    const files = listRes.data.files || [];
    if (files.length === 0) return {};

    const results: Record<string, string> = {};
    
    // Concurrency limit to prevent rate limits
    const CONCURRENCY = 5;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (file) => {
        try {
          const res = await googleDriveClient.files.get({
              fileId: file.id!,
              alt: 'media',
          }, { responseType: 'text' });
          const contentStr = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
          let sourceName = file.name!;
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
    const googleDriveClient = getDriveClient();
    const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
    const commDictFolderId = await findOrCreateFolder(COMMUNITY_DICT_FOLDER_NAME, masterId);
    const genreFolderId = await findOrCreateFolder(genre, commDictFolderId);

    // Dùng Unix Timestamp để không bị đè file nếu nhiều người cùng upload
    const uniqueFilename = `${filename}_${Date.now()}.txt`;

    await googleDriveClient.files.create({
        requestBody: { name: uniqueFilename, parents: [genreFolderId], mimeType: 'text/plain' },
        media: { mimeType: 'text/plain', body: stringToStream(content) },
    });
}

export async function listCommunityDictsFromAdminDrive() {
    const googleDriveClient = getDriveClient();
    const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
    const commDictFolderId = await findOrCreateFolder(COMMUNITY_DICT_FOLDER_NAME, masterId);

    // Lấy danh sách các thư mục thể loại
    const genreRes = await googleDriveClient.files.list({
        q: `'${commDictFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
    });

    const genres = genreRes.data.files || [];
    const results: { id: string, name: string, genre: string, createdTime: string }[] = [];

    // Duyệt qua từng thư mục thể loại để lấy file
    for (const genreFolder of genres) {
        const fileRes = await googleDriveClient.files.list({
            q: `'${genreFolder.id}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name, createdTime)',
            orderBy: 'createdTime desc',
        });
        
        const files = fileRes.data.files || [];
        for (const file of files) {
            results.push({
                id: file.id!,
                name: file.name!,
                genre: genreFolder.name!,
                createdTime: file.createdTime!,
            });
        }
    }

    // Sắp xếp giảm dần theo thời gian tạo
    results.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());
    return results;
}

export async function getDriveFileContent(fileId: string) {
    const googleDriveClient = getDriveClient();
    const res = await googleDriveClient.files.get({
        fileId,
        alt: 'media',
    });
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

export async function deleteDriveFile(fileId: string) {
    const googleDriveClient = getDriveClient();
    await googleDriveClient.files.delete({ fileId });
}
