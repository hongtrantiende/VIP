"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BotIcon, CheckIcon, TrashIcon, RefreshCwIcon, FileTextIcon } from "lucide-react";
import { appendToDictSource } from "@/lib/hooks/use-dict-entries";
import type { DictSource } from "@/lib/db";
import { getPendingCommunityDictsAction, getCommunityDictContentAction, deleteCommunityDictAction } from "@/app/actions/dict-upload";

interface CommunityDictFile {
  id: string;
  name: string;
  genre: string;
  createdTime: string;
}

export function CommunityDictionary({ isAdmin }: { isAdmin: boolean }) {
  const [files, setFiles] = useState<CommunityDictFile[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await getPendingCommunityDictsAction();
      if (res.success && res.files) {
        setFiles(res.files);
      } else {
        throw new Error(res.error || "Không thể tải danh sách");
      }
    } catch (err: any) {
      toast.error(`Lỗi tải từ điển cộng đồng: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleApprove = async (file: CommunityDictFile) => {
    const toastId = toast.loading(`Đang duyệt file ${file.name}...`);
    try {
      // 1. Tải nội dung
      const res = await getCommunityDictContentAction(file.id);
      if (!res.success || !res.content) throw new Error(res.error || "Không thể tải nội dung file");
      
      const content = res.content;
      
      // 2. Parse dữ liệu
      const clean = content.startsWith("\uFEFF") ? content.slice(1) : content;
      const entries = clean
        .split(/\r?\n/)
        .map((line: string) => {
          const idx = line.indexOf("=");
          if (idx < 1) return null;
          return {
            chinese: line.slice(0, idx).trim(),
            vietnamese: line.slice(idx + 1).trim(),
          };
        })
        .filter((e: any): e is { chinese: string; vietnamese: string } => !!e && !!e.chinese && !!e.vietnamese);

      if (entries.length === 0) throw new Error("File rỗng hoặc không đúng định dạng (chinese=vietnamese)");

      // 3. Gộp vào source
      let sourceName = file.name.replace("user_dict_", "");
      const extIdx = sourceName.lastIndexOf("_"); // Loại bỏ Unix timestamp
      if (extIdx !== -1) sourceName = sourceName.slice(0, extIdx);
      if (sourceName.endsWith(".txt")) sourceName = sourceName.slice(0, -4);
      
      const source = sourceName as DictSource;
      const result = await appendToDictSource(source, entries);

      // 4. Xóa file trên Drive
      const delRes = await deleteCommunityDictAction(file.id);
      if (!delRes.success) throw new Error(delRes.error || "Lỗi xóa file trên Drive");

      let msg = `Đã duyệt thành công!`;
      if (result.added > 0) msg += ` +${result.added} từ mới.`;
      if (result.skipped > 0) msg += ` (Bỏ qua ${result.skipped} từ đã có trong [${source}])`;
      
      toast.success(msg, { id: toastId, duration: 5000 });
      setFiles(prev => prev.filter(f => f.id !== file.id));
    } catch (err: any) {
      toast.error(`Lỗi duyệt: ${err.message}`, { id: toastId });
    }
  };

  const handleDelete = async (id: string) => {
    const toastId = toast.loading("Đang xóa...");
    try {
      const res = await deleteCommunityDictAction(id);
      if (!res.success) throw new Error(res.error || "Lỗi xóa file");
      setFiles(prev => prev.filter(f => f.id !== id));
      toast.success("Đã từ chối và xóa file đóng góp", { id: toastId });
    } catch (err: any) {
      toast.error(err.message, { id: toastId });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BotIcon className="size-4" />
              Từ Điển Cộng Đồng (Chờ duyệt trên Google Drive)
            </CardTitle>
            <CardDescription>
              Các bộ từ điển do người dùng tải lên, được phân loại tự động theo Thể Loại truyện
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchFiles} disabled={loading}>
              <RefreshCwIcon className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tên File</TableHead>
                <TableHead>Thể Loại</TableHead>
                <TableHead>Ngày gửi</TableHead>
                <TableHead className="w-[150px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    <FileTextIcon className="size-4 text-muted-foreground" />
                    {file.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{file.genre}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(file.createdTime).toLocaleString("vi-VN")}
                  </TableCell>
                  <TableCell>
                    {isAdmin && (
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => handleApprove(file)} className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50">
                          <CheckIcon className="size-4 mr-1" /> Duyệt
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(file.id)} className="text-destructive">
                          <TrashIcon className="size-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {files.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    Không có từ điển nào đang chờ duyệt trên Google Drive.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
