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

  useEffect(() => {
    if (open && profile) {
      setDisplayName(profile.display_name || "");
      setAvatarUrl(profile.avatar_url || "");
    }
  }, [open, profile]);

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
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Đang lưu..." : "Lưu thay đổi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
