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
      
      const headers = new Headers();
      headers.set('Content-Type', 'text/plain; charset=utf-8');
      
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as any);
      if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        headers.set('Content-Encoding', 'gzip');
      }
      return new Response(bytes, { headers });
    }

    if (action === 'download-all-dicts') {
      const allDicts = await downloadAllDictsFromAdminDrive();
      return NextResponse.json({ success: true, dicts: allDicts });
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
      
      const headers = new Headers();
      headers.set('Content-Type', 'text/plain; charset=utf-8');
      
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as any);
      if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        headers.set('Content-Encoding', 'gzip');
      }
      return new Response(bytes, { headers });
    }

    // ── User-specific actions: cần auth ──
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userIdentifier = user.email?.replace(/[@.]/g, '_') || user.id;

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
      
      const headers = new Headers();
      headers.set('Content-Type', 'application/json; charset=utf-8');
      
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as any);
      if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        headers.set('Content-Encoding', 'gzip');
      }
      return new Response(bytes, { headers });
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
