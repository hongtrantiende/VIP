import { google } from 'googleapis';

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

// Bộ nhớ đệm để tránh tạo trùng thư mục khi chạy song song
const folderCache: Record<string, Promise<string>> = {};

/** Find or create a folder by name under a parent (Race-condition safe) */
async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const cacheKey = `${parentId || 'root'}_${name}`;
  
  if (folderCache[cacheKey]) {
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

/** Get the private TXT folder for a specific user under the master structure */
async function getUserTxtFolder(userIdentifier: string): Promise<string> {
  const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
  const txtRootId = await findOrCreateFolder(TXT_ROOT_FOLDER_NAME, masterId);
  return await findOrCreateFolder(userIdentifier, txtRootId);
}

export async function uploadToAdminDrive(userIdentifier: string, novelId: string, filename: string, content: string) {
  const googleDriveClient = getDriveClient();
  const userFolderId = await getUserNovelFolder(userIdentifier);
  const novelFolderId = await findOrCreateFolder(novelId, userFolderId);

  const q = `name = '${filename}' and '${novelFolderId}' in parents and trashed = false`;
  const listRes = await googleDriveClient.files.list({ q, fields: 'files(id)' });

  if (listRes.data.files && listRes.data.files.length > 0) {
    const fileId = listRes.data.files[0].id!;
    await googleDriveClient.files.update({
      fileId,
      media: { mimeType: 'text/plain', body: content },
    });
    return fileId;
  } else {
    const createRes = await googleDriveClient.files.create({
      requestBody: { name: filename, parents: [novelFolderId], mimeType: 'text/plain' },
      media: { mimeType: 'text/plain', body: content },
      fields: 'id',
    });
    return createRes.data.id;
  }
}

export async function uploadTxtToAdminDrive(userIdentifier: string, novelId: string, filename: string, content: string) {
  const googleDriveClient = getDriveClient();
  const userFolderId = await getUserTxtFolder(userIdentifier);
  const novelFolderId = await findOrCreateFolder(novelId, userFolderId);

  const q = `name = '${filename}' and '${novelFolderId}' in parents and trashed = false`;
  const listRes = await googleDriveClient.files.list({ q, fields: 'files(id)' });

  if (listRes.data.files && listRes.data.files.length > 0) {
    await googleDriveClient.files.update({
      fileId: listRes.data.files[0].id!,
      media: { mimeType: 'text/plain', body: content },
    });
  } else {
    await googleDriveClient.files.create({
      requestBody: { name: filename, parents: [novelFolderId], mimeType: 'text/plain' },
      media: { mimeType: 'text/plain', body: content },
    });
  }
}

export async function downloadFromAdminDrive(userIdentifier: string, novelId: string, filename: string): Promise<string | null> {
  const googleDriveClient = getDriveClient();
  const userFolderId = await getUserNovelFolder(userIdentifier);
  const novelFolderId = await findOrCreateFolder(novelId, userFolderId);

  const q = `name = '${filename}' and '${novelFolderId}' in parents and trashed = false`;
  const listRes = await googleDriveClient.files.list({ q, fields: 'files(id)' });

  if (!listRes.data.files || listRes.data.files.length === 0) return null;

  const fileId = listRes.data.files[0].id!;
  const res = await googleDriveClient.files.get({
    fileId,
    alt: 'media',
  });

  return res.data as string;
}

export async function listFilesFromAdminDrive(userIdentifier: string, novelId: string) {
    const googleDriveClient = getDriveClient();
    const userFolderId = await getUserNovelFolder(userIdentifier);
    const novelFolderId = await findOrCreateFolder(novelId, userFolderId);
  
    const res = await googleDriveClient.files.list({
      q: `'${novelFolderId}' in parents and trashed = false`,
      fields: 'files(id, name, modifiedTime, size)',
    });
  
    return res.data.files || [];
}

export async function listFoldersFromAdminDrive(userIdentifier: string) {
    const googleDriveClient = getDriveClient();
    const userFolderId = await getUserNovelFolder(userIdentifier);
  
    const res = await googleDriveClient.files.list({
      q: `'${userFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
    });
  
    const files = res.data.files || [];
    // Lọc trùng tên thư mục (novelId) để tránh tải lặp lại nếu có rác cũ
    const uniqueNames = Array.from(new Set(files.map(f => f.name)));
    return uniqueNames.map(name => ({ name }));
}

// ─── Dictionary Functions ────────────────────────────────────

export async function uploadDictToAdminDrive(filename: string, content: string) {
    const googleDriveClient = getDriveClient();
    const masterId = await findOrCreateFolder(MASTER_FOLDER_NAME);
    const dictFolderId = await findOrCreateFolder(DICT_FOLDER_NAME, masterId);

    const q = `name = '${filename}' and '${dictFolderId}' in parents and trashed = false`;
    const listRes = await googleDriveClient.files.list({ q, fields: 'files(id)' });

    if (listRes.data.files && listRes.data.files.length > 0) {
        await googleDriveClient.files.update({
            fileId: listRes.data.files[0].id!,
            media: { mimeType: 'text/plain', body: content },
        });
    } else {
        await googleDriveClient.files.create({
            requestBody: { name: filename, parents: [dictFolderId], mimeType: 'text/plain' },
            media: { mimeType: 'text/plain', body: content },
        });
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
