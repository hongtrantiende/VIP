"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { CrownIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { revokeAllModelAssignmentsAction } from "@/app/actions/admin-models";

interface Profile {
  id: string;
  email: string;
  display_name: string;
  vip_until: string | null;
}

interface Lease {
  id: string;
  user_id: string;
  email: string;
  last_active_at: string;
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [freeMode, setFreeMode] = useState(false);

  // Temporary state for the input field of each user
  const [vipDays, setVipDays] = useState<Record<string, string>>({});
  const [quotaInputs, setQuotaInputs] = useState<Record<string, string>>({});
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({});
  const [availableModels, setAvailableModels] = useState<{id: string, name: string}[]>([]);

  // Admin Proxy Settings
  const [adminProxyUrl, setAdminProxyUrl] = useState("");
  const [adminProxyKey, setAdminProxyKey] = useState("");

  const loadData = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    // We need the token to fetch models
    const { data: { session } } = await supabase.auth.getSession();
    
    const email = user?.email?.toLowerCase();
    const admins = [
      "nthanhnam2005@gmail.com",
      "thanhxnam2005@gmail.com"
    ];
    if (!admins.includes(email || "")) {
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
        console.warn("Fetch models failed:", res.status);
      }
    } catch (err) {
      console.warn("Failed to load admin models", err);
    }

    // Load app settings
    const { data: allSettingsData } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["free_mode", "admin_proxy_url", "admin_proxy_key"]);

    if (allSettingsData) {
      const freeModeSetting = allSettingsData.find(s => s.key === "free_mode");
      setFreeMode(freeModeSetting?.value === "true");

      const urlSetting = allSettingsData.find(s => s.key === "admin_proxy_url");
      if (urlSetting) setAdminProxyUrl(urlSetting.value);

      const keySetting = allSettingsData.find(s => s.key === "admin_proxy_key");
      if (keySetting) setAdminProxyKey(keySetting.value);
    }

    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("*")
      .order("email");

    if (profilesError) {
      toast.error(profilesError.message);
    } else {
      setProfiles(profilesData as Profile[]);
    }

    // Load active leases
    const { data: leasesData } = await supabase
      .from("model_leases")
      .select("*")
      .order("last_active_at", { ascending: false });
    
    setLeases(leasesData || []);

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

  const handleRevokeAllModels = async () => {
    if (!confirm("Bạn có chắc chắn muốn thu hồi tất cả model đã cấp cho người dùng không?")) return;
    const toastId = toast.loading("Đang thu hồi...");
    const res = await revokeAllModelAssignmentsAction();
    if (res.success) {
      toast.success("Đã thu hồi tất cả model!", { id: toastId });
      loadData();
    } else {
      toast.error(res.error || "Lỗi khi thu hồi", { id: toastId });
    }
  };

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
      })
      .eq("id", userId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Đã cập nhật lượt dịch thành ${quota} lượt!`);
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

  const handleSaveAdminSettings = async () => {
    try {
      const { saveAdminSettingsAction } = await import("@/app/actions/admin-settings");
      const result = await saveAdminSettingsAction(adminProxyUrl, adminProxyKey);
      
      if (result.success) {
        toast.success("Đã lưu cấu hình Admin Proxy thành công!");
      } else {
        toast.error("Lỗi khi lưu cấu hình: " + result.error);
      }
    } catch (err: any) {
      toast.error(err.message || "Đã xảy ra lỗi");
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
            <div className="flex items-center gap-2">
              <Button onClick={loadData} variant="outline" size="sm">
                <RefreshCwIcon className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
              <Button onClick={handleRevokeAllModels} variant="destructive" size="sm">
                <Trash2Icon className="mr-2 size-4" />
                Thu hồi tất cả Model
              </Button>
            </div>
        </div>
      </div>

      <div className="bg-muted/30 border border-border p-6 rounded-lg space-y-4 mb-8">
        <h2 className="text-lg font-bold text-foreground">Cấu hình API Proxy Server (Dùng chung cho toàn hệ thống)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Base URL (API Endpoint)</label>
            <Input 
              value={adminProxyUrl} 
              onChange={e => setAdminProxyUrl(e.target.value)} 
              placeholder="VD: https://catiecli.sukaka.top/v1/chat/completions"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">API Key (Bearer Token)</label>
            <Input 
              value={adminProxyKey} 
              onChange={e => setAdminProxyKey(e.target.value)} 
              placeholder="Nhập API Key..."
              type="password"
            />
          </div>
        </div>
        <Button onClick={handleSaveAdminSettings} variant="default">Lưu cấu hình Server</Button>
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

      <div className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <RefreshCwIcon className="w-5 h-5 text-blue-500" />
          Model đang được sử dụng ({leases.length})
        </h2>
        <div className="border rounded-lg overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model ID</TableHead>
                <TableHead>Người dùng</TableHead>
                <TableHead>Hoạt động cuối</TableHead>
                <TableHead className="text-right">Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leases.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.id}</TableCell>
                  <TableCell>{l.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(l.last_active_at).toLocaleTimeString("vi-VN")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className="text-green-600 bg-green-50 border-green-200">
                      Đang dùng
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {leases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                    Không có model nào đang được sử dụng.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
