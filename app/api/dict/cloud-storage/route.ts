import { createClient } from '@/lib/supabase/server';
import { 
  uploadToAdminDrive, 
  downloadFromAdminDrive, 
  listFilesFromAdminDrive,
  listFoldersFromAdminDrive,
  uploadDictToAdminDrive,
  downloadDictFromAdminDrive,
  uploadTxtToAdminDrive
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

    // ── Dict actions: dùng service account, không cần user auth ──
    if (action === 'upload-dict') {
      if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
      const content = await req.text();
      await uploadDictToAdminDrive(filename, content);
      return NextResponse.json({ success: true });
    }

    if (action === 'download-dict') {
      if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
      const text = await downloadDictFromAdminDrive(filename);
      if (text === null) return new Response('File not found', { status: 404 });
      return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    // ── User-specific actions: cần auth ──
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userIdentifier = user.email?.replace(/[@.]/g, '_') || user.id;

    if (action === 'list-novels') {
      const folders = await listFoldersFromAdminDrive(userIdentifier);
      return NextResponse.json({ success: true, novels: folders.map(f => f.name) });
    }

    if (action === 'upload-txt') {
      if (!novelId || !filename) return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      const content = await req.text();
      await uploadTxtToAdminDrive(userIdentifier, novelId, filename, content);
      return NextResponse.json({ success: true });
    }

    if (action === 'upload') {
      if (!novelId || !filename) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      }
      const content = await req.text(); // Đọc trực tiếp toàn bộ body là nội dung file
      const fileId = await uploadToAdminDrive(userIdentifier, novelId, filename, content);
      return NextResponse.json({ success: true, fileId });
    }

    if (action === 'download') {
      if (!novelId || !filename) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      }
      const text = await downloadFromAdminDrive(userIdentifier, novelId, filename);
      if (text === null) return new Response('File not found', { status: 404 });
      
      // Trả về Raw Text để xử lý file lớn cực nhanh
      return new Response(text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    if (action === 'list') {
      if (!novelId) return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
      const files = await listFilesFromAdminDrive(userIdentifier, novelId);
      return NextResponse.json({ success: true, files });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Drive Storage Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
