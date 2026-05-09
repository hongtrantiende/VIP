"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { CrownIcon, RefreshCwIcon } from "lucide-react";

interface Profile {
  id: string;
  email: string;
  display_name: string;
  vip_until: string | null;
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [freeMode, setFreeMode] = useState(false);
  const supabase = createClient();

  // Temporary state for the input field of each user
  const [vipDays, setVipDays] = useState<Record<string, string>>({});

  const loadData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email !== "nthanhnam2005@gmail.com") {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setIsAdmin(true);

    // Load free mode setting
    const { data: settingsData } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "free_mode")
      .single();
    
    if (settingsData && settingsData.value === "true") {
      setFreeMode(true);
    } else {
      setFreeMode(false);
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("email");

    if (error) {
      toast.error(error.message);
    } else {
      setProfiles(data as Profile[]);
    }
    setLoading(false);
  };

  const toggleFreeMode = async () => {
    const newValue = !freeMode ? "true" : "false";
    const toastId = toast.loading("Đang cập nhật chế độ Free Test...");
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "free_mode", value: newValue });

    if (error) {
      toast.error(`Lỗi: ${error.message}`, { id: toastId });
    } else {
      setFreeMode(!freeMode);
      toast.success(`Đã ${!freeMode ? "BẬT" : "TẮT"} chế độ Free Test cho toàn server!`, { id: toastId });
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleGrantVip = async (userId: string) => {
    const daysStr = vipDays[userId];
    const days = parseInt(daysStr, 10);
    if (isNaN(days) || days <= 0) {
      toast.error("Vui lòng nhập số ngày hợp lệ");
      return;
    }

    const newDate = new Date();
    newDate.setDate(newDate.getDate() + days);

    const { error } = await supabase
      .from("profiles")
      .update({ vip_until: newDate.toISOString() })
      .eq("id", userId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Đã cấp VIP ${days} ngày cho người dùng!`);
      loadData();
    }
  };

  const handleRevokeVip = async (userId: string) => {
    const { error } = await supabase
      .from("profiles")
      .update({ vip_until: null })
      .eq("id", userId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Đã thu hồi VIP");
      loadData();
    }
  };

  if (loading) return <div className="p-8">Đang tải...</div>;

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-muted-foreground">Bạn không có quyền truy cập trang này.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CrownIcon className="w-6 h-6 text-yellow-500" />
          Khu vực Admin - Quản lý VIP
        </h1>
        <div className="flex items-center gap-3">
          <Button
            variant={freeMode ? "default" : "outline"}
            className={freeMode ? "bg-green-600 hover:bg-green-700 text-white" : "text-muted-foreground"}
            onClick={toggleFreeMode}
            title={freeMode ? "Chế độ Free đang BẬT. Ai cũng được xài VIP." : "Bật để cho phép mọi người xài VIP miễn phí"}
          >
            {freeMode ? "ĐANG BẬT FREE TEST TOÀN SERVER" : "Bật Free Test Toàn Server"}
          </Button>
          <Button variant="outline" onClick={loadData}>
            <RefreshCwIcon className="w-4 h-4 mr-2" />
            Tải lại danh sách
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Tên nhân vật</TableHead>
              <TableHead>Trạng thái VIP</TableHead>
              <TableHead>Cấp thêm VIP (Ngày)</TableHead>
              <TableHead className="text-right">Hành động</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map((p) => {
              const isVip = p.vip_until && new Date(p.vip_until) > new Date();
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.email}</TableCell>
                  <TableCell>{p.display_name || "Chưa có"}</TableCell>
                  <TableCell>
                    {isVip ? (
                      <span className="text-yellow-600 dark:text-yellow-500 font-medium">
                        VIP đến {new Date(p.vip_until!).toLocaleDateString("vi-VN")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Không có VIP</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      placeholder="VD: 10"
                      className="w-24 h-8"
                      value={vipDays[p.id] || ""}
                      onChange={(e) => setVipDays({ ...vipDays, [p.id]: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-yellow-500 hover:bg-yellow-600 text-white"
                        onClick={() => handleGrantVip(p.id)}
                      >
                        Cấp VIP
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRevokeVip(p.id)}
                        disabled={!isVip}
                      >
                        Thu hồi
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {profiles.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Chưa có người dùng nào.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
