"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

const PRESET_AVATARS = [
  "TienTon", "MaDe", "YeuNu", "KiemKhach", "DaoTruong", 
  "HaoHan", "NuHiep", "ThieuGia", "BangChu", "ThanThu",
  "HuyenThoai", "PhongTon", "TuyetNu", "LinhTung", "LongDe",
  "AnGia", "SatThu", "MinhChu", "NgocNu", "DocCo"
].map(seed => `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}`);

export function UserProfileDialog({ profile, open, onOpenChange, onProfileUpdated }: UserProfileDialogProps) {
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || "");
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSave = async () => {
    if (!profile) return;
    setLoading(true);
    
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", profile.id);

    setLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Cập nhật ảnh đại diện thành công!");
      onProfileUpdated();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Cài đặt ảnh đại diện</DialogTitle>
          <DialogDescription>
            Chọn một ảnh đại diện từ danh sách hoặc dán link ảnh tùy thích của bạn (Không tốn bộ nhớ).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label className="font-semibold text-muted-foreground">Chọn ảnh đại diện có sẵn (20 mẫu):</Label>
            <ScrollArea className="h-[220px] w-full rounded-md border p-3 bg-muted/20">
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
          
          <div className="flex flex-col gap-2 mt-2">
            <Label htmlFor="avatar_url" className="font-semibold text-muted-foreground">Hoặc dán Link ảnh tùy chỉnh:</Label>
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
