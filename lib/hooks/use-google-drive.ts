import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";

const CLIENT_ID = "938071252264-7he1aumookj7813fvekc626ur9qg21uf.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Novel_Studio_Dicts";

export function useGoogleDrive() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isGisLoaded, setIsGisLoaded] = useState(false);
  const [tokenClient, setTokenClient] = useState<any>(null);

  useEffect(() => {
    if (typeof window === "undefined" || (window as any).google?.accounts?.oauth2) {
      if ((window as any).google?.accounts?.oauth2) setIsGisLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setIsGisLoaded(true);
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (isGisLoaded && (window as any).google?.accounts?.oauth2 && !tokenClient) {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response: any) => {
          if (response.error !== undefined) {
            toast.error("Đăng nhập Google thất bại: " + response.error);
            return;
          }
          setAccessToken(response.access_token);
          toast.success("Đã kết nối Google Drive!");
        },
      });
      setTokenClient(client);
    }
  }, [isGisLoaded, tokenClient]);

  const login = useCallback(() => {
    if (!tokenClient) {
      toast.error("Google Identity Service chưa sẵn sàng.");
      return;
    }
    tokenClient.requestAccessToken({ prompt: "consent" });
  }, [tokenClient]);

  const logout = useCallback(() => {
    setAccessToken(null);
    toast.success("Đã ngắt kết nối Google Drive.");
  }, []);

  // --- API Wrappers ---

  const getOrCreateFolder = async (token: string): Promise<string> => {
    // Search for folder
    const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // Create folder
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder"
      })
    });
    const createData = await createRes.json();
    return createData.id;
  };

  const uploadFile = async (filename: string, content: string) => {
    if (!accessToken) throw new Error("Chưa kết nối Google Drive");

    const folderId = await getOrCreateFolder(accessToken);

    // Check if file exists
    const q = encodeURIComponent(`name='${filename}' and '${folderId}' in parents and trashed=false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const searchData = await searchRes.json();
    const existingFile = searchData.files && searchData.files.length > 0 ? searchData.files[0] : null;

    // We use a simple multipart upload
    const boundary = "-------314159265358979323846";
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const metadata = {
      name: filename,
      mimeType: "text/plain",
      ...(existingFile ? {} : { parents: [folderId] })
    };

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
      content +
      close_delim;

    const url = existingFile
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const method = existingFile ? "PATCH" : "POST";

    const res = await fetch(url, {
      method: method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    if (!res.ok) {
      throw new Error(`Upload failed: ${res.statusText}`);
    }
    return await res.json();
  };

  const downloadFile = async (filename: string): Promise<string | null> => {
    if (!accessToken) throw new Error("Chưa kết nối Google Drive");

    const folderId = await getOrCreateFolder(accessToken);

    // Search for file
    const q = encodeURIComponent(`name='${filename}' and '${folderId}' in parents and trashed=false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const searchData = await searchRes.json();
    if (!searchData.files || searchData.files.length === 0) {
      return null;
    }

    const fileId = searchData.files[0].id;
    const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!downloadRes.ok) {
      throw new Error(`Download failed: ${downloadRes.statusText}`);
    }
    return await downloadRes.text();
  };

  return {
    accessToken,
    isReady: isGisLoaded && !!tokenClient,
    login,
    logout,
    uploadFile,
    downloadFile,
  };
}
