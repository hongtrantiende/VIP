import { createClient } from '@/lib/supabase/server';
import {
  uploadToAdminDrive,
  downloadFromAdminDrive,
  downloadAllUserNovelsFromAdminDrive,
  listUserNovelsFromAdminDrive,
  uploadDictToAdminDrive,
  downloadDictFromAdminDrive,
  downloadAllDictsFromAdminDrive,
  uploadTxtToAdminDrive,
  listTxtFromAdminDrive,
  uploadCommunityDictToAdminDrive,
  downloadAllCommunityDictsFromAdminDrive,
  listCommunityDictsFromAdminDrive,
  deleteDriveFile,
  getDriveFileContent
} from '@/lib/google-drive-admin-v2';
import { NextResponse } from 'next/server';

// Cho phép body lên đến 50MB (vietphrase ~27MB)
export const maxDuration = 60; // seconds

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    const novelId = searchParams.get('novelId');
    const filename = searchParams.get('filename');

    const getPayload = async () => {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('octet-stream')) {
        return await req.arrayBuffer();
      }
      return await req.text();
    };

    // ── Dict actions: dùng service account, không cần user auth ──
    if (action === 'upload-dict') {
      if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
      const content = await getPayload();
      const size = typeof content === 'string' ? content.length : content.byteLength;
      console.log('UPLOAD-DICT RECEIVED SIZE:', size);
      await uploadDictToAdminDrive(filename, content);
      return NextResponse.json({ success: true, sizeReceived: size });
    }

    if (action === 'download-dict') {
      if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
      const data = await downloadDictFromAdminDrive(filename, true);
      if (data === null) return new Response('File not found', { status: 404 });

      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as any);
      const { decompressIfNeeded } = await import('@/lib/compression');
      const decompressedText = await decompressIfNeeded(bytes);

      return new Response(decompressedText, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        }
      });
    }

    if (action === 'download-all-dicts') {
      const exclude = searchParams.get('exclude') || '';
      const excludeList = exclude.split(',').map(s => s.trim()).filter(Boolean);
      const allDicts = await downloadAllDictsFromAdminDrive(excludeList);
      return NextResponse.json({ success: true, dicts: allDicts });
    }

    if (action === 'contribute-community') {
      const genre = searchParams.get('genre') || 'core';
      const content = await getPayload();
      
      if (!content || typeof content !== 'string') {
        return NextResponse.json({ error: 'Missing content' }, { status: 400 });
      }

      await uploadCommunityDictToAdminDrive(genre, `contrib`, content);
      return NextResponse.json({ success: true });
    }

    if (action === 'download-community-dicts') {
      const allCommDicts = await downloadAllCommunityDictsFromAdminDrive();
      return NextResponse.json({ success: true, dicts: allCommDicts });
    }

    if (action === 'merge-community-dicts') {
      // 1. Lấy danh sách file nhỏ
      const files = await listCommunityDictsFromAdminDrive();
      if (files.length === 0) return NextResponse.json({ success: true, message: 'No files to merge' });

      // 2. Download nội dung
      const allCommDicts = await downloadAllCommunityDictsFromAdminDrive();

      // 3. Với mỗi genre, lấy file gốc, nối từ vào, và upload lại
      for (const [genre, newContent] of Object.entries(allCommDicts)) {
        if (!newContent.trim()) continue;

        const filename = `${genre}_names.txt`; // Giả sử gộp vào _names
        
        // Tải file gốc
        const rawOldData = await downloadDictFromAdminDrive(filename, true);
        let oldContent = '';
        if (rawOldData) {
          const bytes = rawOldData instanceof Uint8Array ? rawOldData : new Uint8Array(rawOldData as any);
          const { decompressIfNeeded } = await import('@/lib/compression');
          oldContent = await decompressIfNeeded(bytes);
        }

        // Nối từ
        const mergedContent = oldContent + (oldContent && !oldContent.endsWith('\n') ? '\n' : '') + newContent;

        // Upload đè file gốc
        await uploadDictToAdminDrive(filename, mergedContent);
      }

      // 4. Xóa các file nhỏ
      for (const file of files) {
        await deleteDriveFile(file.id).catch(e => console.error(e));
      }

      return NextResponse.json({ success: true, mergedFiles: files.length });
    }

    if (action === 'list-txt') {
      const type = searchParams.get('type') as 'text_trung' | 'text_dich';
      if (!type) return NextResponse.json({ error: 'Missing type parameter' }, { status: 400 });
      const files = await listTxtFromAdminDrive(type);
      return NextResponse.json({ success: true, files });
    }

    if (action === 'download-txt') {
      const fileId = searchParams.get('fileId');
      if (!fileId) return NextResponse.json({ error: 'Missing fileId parameter' }, { status: 400 });
      const data = await getDriveFileContent(fileId, true);

      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as any);
      const { decompressIfNeeded } = await import('@/lib/compression');
      const decompressedText = await decompressIfNeeded(bytes);

      return new Response(decompressedText, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        }
      });
    }

    // ── User-specific actions ──
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    // Nếu không có user đăng nhập, sử dụng định danh mặc định 'shared' để lưu vào thư mục chung của hệ thống
    const userIdentifier = user ? (user.email?.replace(/[@.]/g, '_') || user.id) : 'shared';

    if (action === 'list-novels') {
      const novels = await listUserNovelsFromAdminDrive(userIdentifier);
      return NextResponse.json({ success: true, novels });
    }

    if (action === 'upload-txt') {
      const type = searchParams.get('type') as 'text_trung' | 'text_dich';
      const novelName = searchParams.get('novelName');
      if (!type || !novelName) return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      const content = await getPayload();
      const result = await uploadTxtToAdminDrive(type, novelName, content);
      return NextResponse.json({ success: true, result });
    }

    if (action === 'upload') {
      const novelName = searchParams.get('novelName');
      if (!novelName) {
        return NextResponse.json({ error: 'Missing novelName' }, { status: 400 });
      }
      const content = await getPayload();
      const fileId = await uploadToAdminDrive(userIdentifier, novelName, content);
      return NextResponse.json({ success: true, fileId });
    }

    if (action === 'download') {
      const novelName = searchParams.get('novelName');
      if (!novelName) {
        return NextResponse.json({ error: 'Missing novelName' }, { status: 400 });
      }
      const data = await downloadFromAdminDrive(userIdentifier, novelName, true);
      if (data === null) return new Response('File not found', { status: 404 });

      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as any);
      const { decompressIfNeeded } = await import('@/lib/compression');
      const decompressedText = await decompressIfNeeded(bytes);

      return new Response(decompressedText, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      });
    }

    if (action === 'download-all') {
      const novels = await downloadAllUserNovelsFromAdminDrive(userIdentifier);
      return NextResponse.json({ success: true, novels });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Drive Storage Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
