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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CrownIcon, RefreshCwIcon, Trash2Icon, UserIcon, SparklesIcon, CalendarIcon } from "lucide-react";
import { revokeAllModelAssignmentsAction } from "@/app/actions/admin-models";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TranslationTest } from "@/components/admin/translation-test";

interface Profile {
  id: string;
  email: string;
  display_name: string;
  vip_until: string | null;
  admin_assigned_model: string | null;
  admin_model_quota: number;
  admin_daily_quota_limit?: number | null;
  avatar_url?: string | null;
}

interface EditUserDialogProps {
  profile: Profile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableModels: { id: string; name: string }[];
  onSave: (updatedData: {
    id: string;
    display_name: string;
    vip_until: string | null;
    admin_model_quota: number;
    admin_daily_quota_limit: number;
    admin_assigned_model: string | null;
  }) => Promise<void>;
}

function EditUserDialog({ profile, open, onOpenChange, availableModels, onSave }: EditUserDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [isVipActive, setIsVipActive] = useState(false);
  const [vipUntilDate, setVipUntilDate] = useState("");
  const [modelQuota, setModelQuota] = useState(0);
  const [dailyQuotaLimit, setDailyQuotaLimit] = useState(0);
  const [assignedModel, setAssignedModel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && profile) {
      setDisplayName(profile.display_name || "");
      const isVip = profile.vip_until ? new Date(profile.vip_until) > new Date() : false;
      setIsVipActive(isVip);
      
      if (profile.vip_until) {
        const d = new Date(profile.vip_until);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        setVipUntilDate(`${yyyy}-${mm}-${dd}`);
      } else {
        setVipUntilDate("");
      }
      
      setModelQuota(profile.admin_model_quota || 0);
      setDailyQuotaLimit(profile.admin_daily_quota_limit || 0);
      setAssignedModel(profile.admin_assigned_model || "");
    }
  }, [open, profile]);

  const handleGrantDays = (days: number) => {
    setIsVipActive(true);
    const d = new Date();
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    setVipUntilDate(`${yyyy}-${mm}-${dd}`);
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    
    let vipUntilValue: string | null = null;
    if (isVipActive) {
      if (vipUntilDate) {
        vipUntilValue = new Date(vipUntilDate).toISOString();
      } else {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        vipUntilValue = d.toISOString();
      }
    }

    try {
      await onSave({
        id: profile.id,
        display_name: displayName,
        vip_until: vipUntilValue,
        admin_model_quota: Number(modelQuota),
        admin_daily_quota_limit: Number(dailyQuotaLimit),
        admin_assigned_model: assignedModel || null,
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <UserIcon className="w-5 h-5 text-primary" />
            Cấu hình người dùng
          </DialogTitle>
          <DialogDescription>
            Thay đổi thông tin nhân vật, trạng thái VIP, hạn mức dịch của <span className="font-semibold text-foreground">{profile?.email}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          {/* Display Name */}
          <div className="grid gap-2">
            <Label htmlFor="edit_display_name" className="font-semibold text-sm">Tên nhân vật (Nickname)</Label>
            <Input
              id="edit_display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Nhập tên nhân vật..."
            />
          </div>

          <hr className="border-border" />

          {/* VIP Status Group */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold cursor-pointer select-none text-sm flex items-center gap-2" htmlFor="vip_toggle">
                <CrownIcon className="size-4 text-yellow-500" />
                Kích hoạt trạng thái VIP
              </Label>
              <input
                type="checkbox"
                id="vip_toggle"
                checked={isVipActive}
                onChange={(e) => setIsVipActive(e.target.checked)}
                className="size-4 rounded border-gray-300 text-yellow-600 focus:ring-yellow-500 cursor-pointer"
              />
            </div>

            {isVipActive && (
              <div className="space-y-3 bg-yellow-500/5 border border-yellow-500/10 p-3 rounded-lg">
                <div className="grid gap-2">
                  <Label htmlFor="vip_until_date" className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
                    <CalendarIcon className="size-3" />
                    Ngày hết hạn VIP
                  </Label>
                  <Input
                    id="vip_until_date"
                    type="date"
                    value={vipUntilDate}
                    onChange={(e) => setVipUntilDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    className="h-7 text-xs border-yellow-500/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10"
                    onClick={() => handleGrantDays(30)}
                  >
                    +30 ngày
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    className="h-7 text-xs border-yellow-500/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10"
                    onClick={() => handleGrantDays(90)}
                  >
                    +90 ngày
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    className="h-7 text-xs border-yellow-500/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10"
                    onClick={() => handleGrantDays(365)}
                  >
                    +1 năm
                  </Button>
                </div>
              </div>
            )}
          </div>

          <hr className="border-border" />

          {/* Quota Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="daily_quota" className="font-semibold text-sm text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <SparklesIcon className="size-3.5" />
                Hạn mức / ngày
              </Label>
              <Input
                id="daily_quota"
                type="number"
                min={0}
                value={dailyQuotaLimit}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setDailyQuotaLimit(val);
                  setModelQuota(val);
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="model_quota" className="font-semibold text-sm text-blue-600 dark:text-blue-400">
                Lượt còn lại hôm nay
              </Label>
              <Input
                id="model_quota"
                type="number"
                min={0}
                value={modelQuota}
                onChange={(e) => setModelQuota(Number(e.target.value))}
              />
            </div>
          </div>

          <hr className="border-border" />

          {/* Model Selection */}
          <div className="grid gap-2">
            <Label htmlFor="edit_assigned_model" className="font-semibold text-sm text-purple-600 dark:text-purple-400">
              Model dịch được cấp riêng
            </Label>
            {availableModels.length > 0 ? (
              <select
                id="edit_assigned_model"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={assignedModel}
                onChange={(e) => setAssignedModel(e.target.value)}
              >
                <option value="">-- Mặc định (Dùng model chung của hệ thống) --</option>
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="edit_assigned_model"
                placeholder="Nhập Model ID..."
                value={assignedModel}
                onChange={(e) => setAssignedModel(e.target.value)}
              />
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 border-t pt-4">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [freeMode, setFreeMode] = useState(false);
  const [adminModelEnabled, setAdminModelEnabled] = useState(true);
  const [availableModels, setAvailableModels] = useState<{id: string, name: string}[]>([]);

  // Admin Proxy Settings
  const [adminProxyUrl, setAdminProxyUrl] = useState("");
  const [adminProxyKey, setAdminProxyKey] = useState("");
  const [adminChatModel, setAdminChatModel] = useState("");
  const [scanning, setScanning] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

  const handleScanModels = async () => {
    if (!adminProxyUrl || !adminProxyKey) {
      toast.error("Vui lòng nhập URL và API Key trước khi quét");
      return;
    }
    setScanning(true);
    const toastId = toast.loading("Đang quét model từ Proxy...");
    try {
      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl: adminProxyUrl, proxyKey: adminProxyKey })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.data && Array.isArray(data.data)) {
          const models = data.data.map((m: any) => ({
            id: m.id,
            name: m.id.replace("gcli-", "").replace("假流式/", "[No Stream] ")
          }));
          setAvailableModels(models);
          toast.success(`Đã tìm thấy ${models.length} models`, { id: toastId });
        } else {
          toast.error("Không tìm thấy model nào", { id: toastId });
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || `Lỗi khi quét model: HTTP ${res.status}`, { id: toastId });
      }
    } catch (err) {
      toast.error("Lỗi kết nối", { id: toastId });
    }
    setScanning(false);
  };

  const loadData = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
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
      }
    } catch (err) {
      console.warn("Failed to load admin models", err);
    }

    const { data: allSettingsData } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["free_mode", "admin_proxy_url", "admin_proxy_key", "admin_model_enabled", "admin_chat_model"]);

    if (allSettingsData) {
      const freeModeSetting = allSettingsData.find(s => s.key === "free_mode");
      setFreeMode(freeModeSetting?.value === "true");

      const adminModelSetting = allSettingsData.find(s => s.key === "admin_model_enabled");
      setAdminModelEnabled(adminModelSetting?.value !== "false");

      const urlSetting = allSettingsData.find(s => s.key === "admin_proxy_url");
      if (urlSetting) setAdminProxyUrl(urlSetting.value);

      const keySetting = allSettingsData.find(s => s.key === "admin_proxy_key");
      if (keySetting) setAdminProxyKey(keySetting.value);

      const chatModelSetting = allSettingsData.find(s => s.key === "admin_chat_model");
      if (chatModelSetting) setAdminChatModel(chatModelSetting.value);
    }

    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("*")
      .order("email");

    if (profilesError) {
      toast.error("Lỗi tải profiles: " + profilesError.message);
    } else {
      setProfiles(profilesData as Profile[]);
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

  const toggleAdminModel = async () => {
    const newValue = !adminModelEnabled ? "true" : "false";
    const toastId = toast.loading("Đang cập nhật trạng thái Admin Model...");
    const supabase = createClient();
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "admin_model_enabled", value: newValue });

    if (error) {
      toast.error(`Lỗi: ${error.message}`, { id: toastId });
    } else {
      setAdminModelEnabled(!adminModelEnabled);
      toast.success(`Đã ${!adminModelEnabled ? "BẬT" : "TẮT"} cấp Model Admin cho toàn server!`, { id: toastId });
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

  const handleSaveUser = async (updatedData: {
    id: string;
    display_name: string;
    vip_until: string | null;
    admin_model_quota: number;
    admin_daily_quota_limit: number;
    admin_assigned_model: string | null;
  }) => {
    const toastId = toast.loading("Đang cập nhật thông tin...");
    const supabase = createClient();

    const currentVnDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })).toDateString();

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: updatedData.display_name.trim(),
        vip_until: updatedData.vip_until,
        admin_model_quota: updatedData.admin_model_quota,
        admin_daily_quota_limit: updatedData.admin_daily_quota_limit,
        admin_quota_last_reset: currentVnDate,
        admin_assigned_model: updatedData.admin_assigned_model || null,
      })
      .eq("id", updatedData.id);

    if (error) {
      toast.error(`Cập nhật thất bại: ${error.message}`, { id: toastId });
      throw error;
    } else {
      toast.success("Cập nhật thông tin người dùng thành công!", { id: toastId });
      loadData();
    }
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Đang tải thông tin Admin...</div>;

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-muted-foreground font-medium">Bạn không có quyền truy cập trang này.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      {/* Title block */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b pb-6">
        <div>
          <h1 className="text-3xl font-extrabold flex items-center gap-2 tracking-tight">
            <CrownIcon className="w-8 h-8 text-yellow-500 animate-pulse" />
            Khu vực Quản trị VIP & Hệ thống
          </h1>
          <p className="text-muted-foreground mt-1">Cấu hình API Proxy và quản lý quyền lợi, lượt dịch của thành viên.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={freeMode ? "default" : "outline"}
            className={freeMode ? "bg-green-600 hover:bg-green-700 text-white shadow-sm font-semibold" : "text-muted-foreground"}
            onClick={toggleFreeMode}
            title={freeMode ? "Chế độ Free đang BẬT. Ai cũng được xài VIP." : "Bật để cho phép mọi người xài VIP miễn phí"}
          >
            {freeMode ? "FREE TEST: ĐANG BẬT" : "Bật Free Test Toàn Server"}
          </Button>
          <Button
            variant={adminModelEnabled ? "default" : "outline"}
            className={adminModelEnabled ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm font-semibold" : "text-muted-foreground"}
            onClick={toggleAdminModel}
            title={adminModelEnabled ? "Đang cấp phát model Admin cho người dùng." : "Bật để cấp model Admin"}
          >
            {adminModelEnabled ? "CẤP MODEL ADMIN: ĐANG BẬT" : "Bật cấp Model Admin"}
          </Button>
          <Button onClick={loadData} variant="outline" size="sm" className="h-9">
            <RefreshCwIcon className="mr-2 size-4" />
            Làm mới
          </Button>
          <Button onClick={handleRevokeAllModels} variant="destructive" size="sm" className="h-9">
            <Trash2Icon className="mr-2 size-4" />
            Thu hồi Model
          </Button>
        </div>
      </div>

      <Tabs defaultValue="members-settings" className="space-y-6">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2">
          <TabsTrigger value="members-settings">Thành viên & Cấu hình</TabsTrigger>
          <TabsTrigger value="translate-test">Dịch Thử Nghiệm</TabsTrigger>
        </TabsList>

        <TabsContent value="members-settings" className="space-y-8 mt-6">
          {/* Proxy Settings */}
          <div className="bg-card border border-border shadow-sm rounded-xl p-6 space-y-6">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <SparklesIcon className="w-5 h-5 text-indigo-500" />
              Cấu hình API Proxy Server (Dùng chung cho toàn hệ thống)
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-muted-foreground">Base URL (API Endpoint)</label>
                <Input 
                  value={adminProxyUrl} 
                  onChange={e => setAdminProxyUrl(e.target.value)} 
                  placeholder="VD: https://catiecli.sukaka.top/v1/chat/completions"
                  className="bg-muted/30 focus-visible:ring-indigo-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-muted-foreground">API Key (Bearer Token)</label>
                <Input 
                  value={adminProxyKey} 
                  onChange={e => setAdminProxyKey(e.target.value)} 
                  placeholder="Nhập API Key..."
                  type="password"
                  className="bg-muted/30 focus-visible:ring-indigo-500"
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <label className="text-sm font-semibold text-muted-foreground">Model mặc định cho Chat AI (toàn hệ thống)</label>
              <div className="flex items-center gap-3">
                {availableModels.length > 0 ? (
                  <select
                    className="flex h-10 w-full max-w-md rounded-md border border-input bg-muted/30 px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500"
                    value={adminChatModel}
                    onChange={e => setAdminChatModel(e.target.value)}
                  >
                    <option value="">-- Dùng cùng model dịch --</option>
                    {availableModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={adminChatModel}
                    onChange={e => setAdminChatModel(e.target.value)}
                    placeholder="Nhập model ID cho chat (bỏ trống = dùng model dịch)"
                    className="max-w-md bg-muted/30"
                  />
                )}
                <Button
                  variant="outline"
                  onClick={async () => {
                    const supabase = createClient();
                    const { error } = await supabase
                      .from("app_settings")
                      .upsert({ key: "admin_chat_model", value: adminChatModel });
                    if (error) {
                      toast.error("Lỗi: " + error.message);
                    } else {
                      toast.success(adminChatModel ? `Đã đặt model chat: ${adminChatModel}` : "Chat sẽ dùng model dịch");
                    }
                  }}
                  className="px-4"
                >
                  Lưu chat model
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleScanModels}
                  disabled={scanning}
                  className="gap-2"
                >
                  <RefreshCwIcon className={`size-4 ${scanning ? "animate-spin" : ""}`} />
                  Quét Model từ Proxy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground italic">Model này dùng cho AI Chat của toàn bộ người dùng. Bỏ trống = dùng model dịch đã cấp riêng cho từng user.</p>
            </div>

            <div className="pt-2">
              <Button onClick={handleSaveAdminSettings} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
                Lưu cấu hình Server
              </Button>
            </div>
          </div>

          {/* User Management Table */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-foreground">Danh sách người dùng và Quyền hạn</h2>
            <div className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-[300px]">Người dùng</TableHead>
                    <TableHead className="w-[200px]">Trạng thái VIP</TableHead>
                    <TableHead className="w-[180px]">Lượt dịch tự động</TableHead>
                    <TableHead className="w-[220px]">Model được cấp riêng</TableHead>
                    <TableHead className="text-right pr-6">Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((p) => {
                    const isVip = p.vip_until && new Date(p.vip_until) > new Date();
                    return (
                      <TableRow key={p.id} className="hover:bg-muted/10 transition-colors">
                        {/* User profile info */}
                        <TableCell className="font-medium py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative size-10 shrink-0">
                              <div className={`flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm overflow-hidden border ${isVip ? "ring-2 ring-yellow-400 ring-offset-1 dark:ring-offset-slate-900" : ""}`}>
                                {p.avatar_url ? (
                                  <img src={p.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                                ) : (
                                  (p.display_name || p.email || "U").substring(0, 2).toUpperCase()
                                )}
                              </div>
                              {isVip && (
                                <div className="absolute -top-1 -right-1 bg-yellow-400 text-yellow-900 rounded-full p-0.5 shadow-md">
                                  <CrownIcon className="size-3" />
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-foreground truncate max-w-[200px]">
                                {p.display_name || "Chưa đặt tên"}
                              </span>
                              <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={p.email}>
                                {p.email}
                              </span>
                            </div>
                          </div>
                        </TableCell>

                        {/* VIP status */}
                        <TableCell>
                          {isVip ? (
                            <div className="flex flex-col">
                              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 dark:bg-yellow-950/60 px-2.5 py-0.5 text-xs font-semibold text-yellow-800 dark:text-yellow-400 w-fit">
                                <CrownIcon className="size-3" />
                                VIP hoạt động
                              </span>
                              <span className="text-xs text-muted-foreground mt-1">
                                Hết hạn: {new Date(p.vip_until!).toLocaleDateString("vi-VN")}
                              </span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-800 dark:text-slate-300">
                              Thành viên thường
                            </span>
                          )}
                        </TableCell>

                        {/* Quota */}
                        <TableCell>
                          <div className="flex flex-col gap-1.5">
                            <span className="font-semibold text-sm">
                              {p.admin_model_quota ?? 0} / {p.admin_daily_quota_limit ?? 0}
                            </span>
                            <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-500 rounded-full transition-all duration-300" 
                                style={{ 
                                  width: `${Math.min(100, p.admin_daily_quota_limit ? ((p.admin_model_quota ?? 0) / p.admin_daily_quota_limit) * 100 : 0)}%` 
                                }}
                              />
                            </div>
                          </div>
                        </TableCell>

                        {/* Assigned Model */}
                        <TableCell>
                          {p.admin_assigned_model ? (
                            <span className="inline-flex items-center rounded-full bg-purple-100 dark:bg-purple-950 px-2.5 py-0.5 text-xs font-semibold text-purple-800 dark:text-purple-400 truncate max-w-[200px]" title={p.admin_assigned_model}>
                              {p.admin_assigned_model.replace("gcli-", "").replace("假流式/", "[No Stream] ")}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Mặc định hệ thống</span>
                          )}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right pr-6">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingProfile(p)}
                            className="hover:bg-primary hover:text-primary-foreground font-semibold"
                          >
                            Chỉnh sửa
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {profiles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        Chưa có người dùng nào được đăng ký.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="translate-test" className="space-y-6 mt-6">
          <TranslationTest />
        </TabsContent>
      </Tabs>

      {/* Edit User Dialog */}
      <EditUserDialog
        profile={editingProfile}
        open={editingProfile !== null}
        onOpenChange={(open) => !open && setEditingProfile(null)}
        availableModels={availableModels}
        onSave={handleSaveUser}
      />
    </div>
  );
}
