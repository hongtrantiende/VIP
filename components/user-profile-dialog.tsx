"use client";

import { useState, useEffect } from "react";
import { updateProfileAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserProfile } from "@/lib/hooks/use-profile";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Upload } from "lucide-react";

interface UserProfileDialogProps {
  profile: UserProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfileUpdated: () => void;
}

const PRESET_AVATARS = Array.from({ length: 20 }, (_, i) => `/avatars/avatar_${i + 1}.png`);

export function UserProfileDialog({ profile, open, onOpenChange, onProfileUpdated }: UserProfileDialogProps) {
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || "");
  const [loading, setLoading] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);

  useEffect(() => {
    if (open && profile) {
      setDisplayName(profile.display_name || "");
      setAvatarUrl(profile.avatar_url || "");
    }
  }, [open, profile]);

  const compressAndCropAvatar = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Lỗi đọc tệp tin."));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error("Lỗi tải hình ảnh để xử lý."));
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            const SIZE = 256;
            canvas.width = SIZE;
            canvas.height = SIZE;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Không thể khởi tạo bộ dựng ảnh Canvas."));
              return;
            }

            const { width, height } = img;
            let sx = 0, sy = 0, sWidth = width, sHeight = height;

            // Crop a square from the center of the source image
            if (width > height) {
              sWidth = height;
              sx = (width - height) / 2;
            } else {
              sHeight = width;
              sy = (height - width) / 2;
            }

            // Draw to the 256x256 canvas
            ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, SIZE, SIZE);

            // Export as JPEG with 0.85 quality
            const base64 = canvas.toDataURL("image/jpeg", 0.85);
            resolve(base64);
          } catch (err) {
            reject(err);
          }
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Vui lòng chọn tệp tin ảnh hợp lệ!");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("Kích thước ảnh quá lớn! Vui lòng chọn ảnh dưới 10MB.");
      return;
    }

    setProcessingImage(true);
    const toastId = toast.loading("Đang xử lý và nén ảnh đại diện...");

    try {
      const base64Data = await compressAndCropAvatar(file);
      setAvatarUrl(base64Data);
      toast.success("Tải ảnh và tối ưu hóa thành công!", { id: toastId });
    } catch (err: any) {
      console.error("Lỗi xử lý ảnh đại diện:", err);
      toast.error(`Không thể xử lý ảnh: ${err.message || "Lỗi không xác định"}`, { id: toastId });
    } finally {
      setProcessingImage(false);
      e.target.value = ""; // Reset input
    }
  };

  const handleSave = async () => {
    if (!profile) return;
    if (!displayName.trim()) {
      toast.error("Tên nhân vật không được để trống!");
      return;
    }
    setLoading(true);
    
    try {
      const res = await updateProfileAction(displayName, avatarUrl);

      if (!res.success) {
        console.error("Profile save error:", res.error, "status:", res.status, "code:", res.code);
        toast.error(`Lỗi: ${res.error || "Không rõ"}`);
      } else {
        toast.success("Cập nhật thông tin tài khoản thành công!");
        onProfileUpdated();
        onOpenChange(false);
      }
    } catch (err: any) {
      console.error("Profile save exception:", err);
      toast.error(`Lỗi không xác định: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Cài đặt tài khoản</DialogTitle>
          <DialogDescription>
            Cập nhật tên nhân vật và ảnh đại diện của bạn.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {/* Live Preview Section */}
          <div className="flex flex-col items-center justify-center gap-1.5 py-1.5 border-b border-muted/40 pb-3">
            <div className="relative w-24 h-24 rounded-full overflow-hidden border-4 border-primary/20 shadow-xl group hover:border-primary/60 transition-all duration-300">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar Preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground text-2xl font-bold">
                  {displayName ? displayName.slice(0, 2).toUpperCase() : "?"}
                </div>
              )}
              {processingImage && (
                <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground font-medium">Xem trước ảnh đại diện</span>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="display_name" className="font-semibold text-muted-foreground">Tên nhân vật (Nickname):</Label>
            <Input
              id="display_name"
              placeholder="Nhập tên nhân vật..."
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2 mt-2">
            <Label className="font-semibold text-muted-foreground">Chọn ảnh đại diện có sẵn (20 mẫu):</Label>
            <ScrollArea className="h-[180px] w-full rounded-md border p-3 bg-muted/20">
              <div className="grid grid-cols-5 gap-3">
                {PRESET_AVATARS.map((url, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAvatarUrl(url)}
                    className={`relative aspect-square rounded-full overflow-hidden border-2 transition-all hover:scale-105 ${
                      avatarUrl === url ? "border-primary ring-2 ring-primary ring-offset-1 ring-offset-background scale-105" : "border-transparent"
                    }`}
                  >
                    <img src={url} alt={`Avatar ${idx + 1}`} className="w-full h-full object-cover bg-white/10" />
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
          
          <div className="flex flex-col gap-2 mt-1">
            <Label className="font-semibold text-muted-foreground">Hoặc tải ảnh từ máy tính:</Label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                id="avatar-file-upload"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                disabled={processingImage || loading}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 border-dashed hover:border-primary hover:text-primary transition-all"
                onClick={() => document.getElementById("avatar-file-upload")?.click()}
                disabled={processingImage || loading}
              >
                {processingImage ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang xử lý ảnh...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Chọn tệp tin ảnh từ thiết bị
                  </>
                )}
              </Button>
            </div>
          </div>
          
          <div className="flex flex-col gap-2 mt-1">
            <Label htmlFor="avatar_url" className="font-semibold text-muted-foreground">Hoặc dán Link ảnh đại diện:</Label>
            <Input
              id="avatar_url"
              placeholder="VD: https://i.imgur.com/xxxxx.jpg"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Hủy</Button>
          <Button onClick={handleSave} disabled={loading || processingImage}>
            {loading ? "Đang lưu..." : "Lưu thay đổi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
