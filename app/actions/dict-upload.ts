"use server";

import { uploadDictToAdminDrive, uploadToAdminDrive } from "@/lib/google-drive-admin-v2";

export async function uploadDictServerAction(formData: FormData) {
  try {
    const filename = formData.get("filename") as string;
    const file = formData.get("file") as File;
    if (!filename || !file) throw new Error("Missing filename or file");
    
    const buffer = Buffer.from(await file.arrayBuffer());
    const content = buffer.toString("utf-8");

    await uploadDictToAdminDrive(filename, content);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function uploadNovelDictServerAction(userIdentifier: string, novelId: string, filename: string, content: string) {
  try {
    const novelName = `${novelId}_${filename}`;
    const fileId = await uploadToAdminDrive(userIdentifier, novelName, content);
    return { success: true, fileId };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ─── Community Dictionary Actions ────────────────────────

export async function submitCommunityDictAction(genre: string, filename: string, content: string) {
  try {
    const { uploadCommunityDictToAdminDrive } = await import('@/lib/google-drive-admin-v2');
    await uploadCommunityDictToAdminDrive(genre, filename, content);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getPendingCommunityDictsAction() {
  try {
    const { listCommunityDictsFromAdminDrive } = await import('@/lib/google-drive-admin-v2');
    const files = await listCommunityDictsFromAdminDrive();
    return { success: true, files };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getCommunityDictContentAction(fileId: string) {
  try {
    const { getDriveFileContent } = await import('@/lib/google-drive-admin-v2');
    const content = await getDriveFileContent(fileId);
    return { success: true, content };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteCommunityDictAction(fileId: string) {
  try {
    const { deleteDriveFile } = await import('@/lib/google-drive-admin-v2');
    await deleteDriveFile(fileId);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
