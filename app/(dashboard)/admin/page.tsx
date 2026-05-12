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

  // Temporary state for the input field of each user
  const [vipDays, setVipDays] = useState<Record<string, string>>({});
  const [quotaInputs, setQuotaInputs] = useState<Record<string, string>>({});
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({});
  const [availableModels, setAvailableModels] = useState<{id: string, name: string}[]>([]);

  const loadData = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    // We need the token to fetch models
    const { data: { session } } = await supabase.auth.getSession();
    
    const email = user?.email?.toLowerCase();
    if (email !== "nthanhnam2005@gmail.com" && email !== "thanhxnam2005@gmail.com") {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setIsAdmin(true);
    // Fetch dynamic models
    try {
      const res = await fetch("/api/admin/models");
      if (res.ok) {
        const data = await res.json();
        if (data && data.data && Array.isArray(data.data)) {
          const models = data.data.map((m: any) => ({
            id: m.id,
            name: m.id.replace("gcli-", "").replace("假流式/", "[No Stream] ")
          }));
          setAvailableModels(models);
        }
      } else {
        console.error("Fetch models failed:", res.status);
      }
    } catch (err) {
      console.error("Failed to load admin models", err);
    }

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
    const supabase = createClient();
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

    const supabase = createClient();
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

  const handleGrantQuota = async (userId: string) => {
    const quotaStr = quotaInputs[userId];
    const quota = parseInt(quotaStr, 10);
    const model = modelInputs[userId] || "gcli-gemini-3-pro-preview"; // Mặc định nếu không chọn

    if (isNaN(quota) || quota < 0) {
      toast.error("Vui lòng nhập số lượt dịch hợp lệ");
      return;
    }

    const currentVnDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"})).toDateString();

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ 
        admin_model_quota: quota,
        admin_daily_quota_limit: quota,
        admin_quota_last_reset: currentVnDate,
        admin_assigned_model: model 
      })
      .eq("id", userId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Đã cập nhật lượt dịch thành ${quota} lượt với model ${model}!`);
      loadData();
    }
  };

  const handleRevokeVip = async (userId: string) => {
    const supabase = createClient();
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
              <TableHead>Lượt Admin</TableHead>
              <TableHead>Hành động</TableHead>
              <TableHead className="text-right">Khác</TableHead>
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
                  <TableCell className="font-semibold text-blue-600 dark:text-blue-400">
                    <div className="flex flex-col">
                      <span>{(p as any).admin_model_quota || 0} lượt</span>
                      {(p as any).admin_assigned_model && (
                        <span className="text-[10px] text-muted-foreground font-normal break-all max-w-[120px]">
                          {(p as any).admin_assigned_model}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          placeholder="Ngày VIP"
                          className="w-20 h-8 text-xs"
                          value={vipDays[p.id] || ""}
                          onChange={(e) => setVipDays({ ...vipDays, [p.id]: e.target.value })}
                        />
                        <Button
                          size="sm"
                          className="bg-yellow-500 hover:bg-yellow-600 text-white h-8 text-xs"
                          onClick={() => handleGrantVip(p.id)}
                        >
                          Cấp VIP
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1 border-t pt-2 mt-1">
                        <select
                          className="h-8 text-xs border rounded-md px-2 bg-background w-full"
                          value={modelInputs[p.id] || "gcli-gemini-3-pro-preview"}
                          onChange={(e) => setModelInputs({ ...modelInputs, [p.id]: e.target.value })}
                        >
                          {availableModels.length > 0 ? (
                            availableModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))
                          ) : (
                            <option value="gcli-gemini-3-pro-preview">Đang tải models...</option>
                          )}
                        </select>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            placeholder="Số lượt"
                            className="w-20 h-8 text-xs"
                            value={quotaInputs[p.id] || ""}
                            onChange={(e) => setQuotaInputs({ ...quotaInputs, [p.id]: e.target.value })}
                          />
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white h-8 text-xs flex-1"
                            onClick={() => handleGrantQuota(p.id)}
                          >
                            Cấp lượt dịch
                          </Button>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRevokeVip(p.id)}
                        disabled={!isVip}
                        className="h-8 text-xs"
                      >
                        Thu hồi VIP
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
