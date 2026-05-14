import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { uploadDictToAdminDrive } from '@/lib/google-drive-admin-v2';

export const maxDuration = 60; // 60 seconds to allow for final upload

export async function POST(req: Request) {
  try {
    const { filename, chunk, index, total } = await req.json();
    
    if (!filename) {
      return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
    }

    const tmpDir = os.tmpdir();
    // Use a safe filename
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
    const filePath = path.join(tmpDir, `upload_chunk_${safeFilename}`);
    
    if (index === 0 && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    fs.appendFileSync(filePath, chunk, 'utf8');
    
    if (index === total - 1) {
      const content = fs.readFileSync(filePath, 'utf-8');
      await uploadDictToAdminDrive(filename, content);
      fs.unlinkSync(filePath);
      return NextResponse.json({ success: true, finished: true });
    }
    
    return NextResponse.json({ success: true, finished: false });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
