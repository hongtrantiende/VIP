"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { type User } from "@supabase/supabase-js";
import { ShieldCheckIcon, UserIcon } from "lucide-react";

type AdminUser = {
  id: string;
  email: string | null;
  createdAt: string | null;
  isVip: boolean;
  vipUntil: string | null;
  isAdmin: boolean;
};

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);
  const [authLoading, setAuthLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [vipDays, setVipDays] = useState<Record<string, string>>({});

  useEffect(() => {
    const checkAuth = async () => {
      if (!supabase) {
        setAuthLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      setIsAdmin(true);
      setAuthLoading(false);
    };

    checkAuth();
  }, []);

  const getAccessToken = async () => {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  };

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Không tìm thấy phiên đăng nhập.");
      }

      const response = await fetch("/api/admin/users", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Không thể tải danh sách người dùng.");
      }
      setUsers(payload.users ?? []);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Lỗi tải danh sách người dùng.");
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchUsers();
  }, [fetchUsers, isAdmin]);

  const updateVip = async (userId: string, currentVip: boolean) => {
    setActionLoading(true);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Không tìm thấy phiên đăng nhập.");
      }

      let vipUntil: string | null = null;
      if (!currentVip) {
        const days = parseInt(vipDays[userId] || "30", 10);
        const date = new Date();
        date.setDate(date.getDate() + days);
        vipUntil = date.toISOString();
      }

      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId, isVip: !currentVip, vipUntil }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Cập nhật VIP thất bại.");
      }
      toast.success(`Đã ${!currentVip ? "cấp" : "thu hồi"} VIP thành công`);
      fetchUsers();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Lỗi cập nhật VIP.");
    } finally {
      setActionLoading(false);
    }
  };

  const visibleUsers = users.filter((user) =>
    user.email?.toLowerCase().includes(search.toLowerCase()) ?? false,
  );

  if (authLoading) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">Đang kiểm tra quyền admin...</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (false) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Quyền truy cập bị từ chối</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Tính năng quản trị chỉ dành cho tài khoản admin.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheckIcon className="size-5" />
            <h1 className="text-3xl font-bold">Bảng Admin</h1>
          </div>
          <p className="mt-1 text-muted-foreground">Quản lý VIP và người dùng.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <UserIcon className="size-4" />
            <span>{user?.user_metadata?.full_name || user?.email || user?.id}</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              Admin
            </span>
            {Boolean(user?.app_metadata?.isVip || user?.user_metadata?.isVip) && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                VIP
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={fetchUsers} disabled={loadingUsers || actionLoading}>
            {loadingUsers ? "Đang tải..." : "Tải lại người dùng"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Danh sách người dùng</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm email người dùng"
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-separate border-spacing-y-2">
            <thead>
                <tr className="text-left text-sm text-muted-foreground">
                  <th>Email</th>
                  <th>ID</th>
                  <th>VIP / Hạn dùng</th>
                  <th>Admin</th>
                  <th>Hành động</th>
                </tr>
            </thead>
            <tbody>
              {visibleUsers.map((adminUser) => (
                <tr key={adminUser.id} className="align-top border-b border-border py-3">
                  <td className="py-3 text-sm">{adminUser.email || "(Không có email)"}</td>
                  <td className="py-3 text-sm text-muted-foreground">{adminUser.id}</td>
                  <td className="py-3 text-sm">
                    {adminUser.isVip ? (
                      <div className="flex flex-col">
                        <span className="text-amber-600 font-medium">Có</span>
                        <span className="text-[10px] text-muted-foreground">
                          Hạn: {adminUser.vipUntil ? new Date(adminUser.vipUntil).toLocaleDateString("vi-VN") : "Vĩnh viễn"}
                        </span>
                      </div>
                    ) : (
                      "Không"
                    )}
                  </td>
                  <td className="py-3 text-sm">{adminUser.isAdmin ? "Có" : "Không"}</td>
                  <td className="py-3 text-sm">
                    <div className="flex items-center gap-2">
                      {!adminUser.isVip && (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            className="h-8 w-16 text-xs"
                            placeholder="Ngày"
                            value={vipDays[adminUser.id] || "30"}
                            onChange={(e) => setVipDays(prev => ({ ...prev, [adminUser.id]: e.target.value }))}
                          />
                          <span className="text-[10px] text-muted-foreground">ngày</span>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant={adminUser.isVip ? "destructive" : "secondary"}
                        onClick={() => updateVip(adminUser.id, adminUser.isVip)}
                        disabled={actionLoading}
                      >
                        {adminUser.isVip ? "Thu hồi" : "Cấp VIP"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    Không tìm thấy người dùng.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}
