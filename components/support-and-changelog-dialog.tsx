"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { BugIcon, HistoryIcon, MailIcon, UsersIcon, MessageSquareIcon, HeartIcon, DownloadIcon } from "lucide-react";

interface SupportAndChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const changelog = [
  { date: "28/05", title: "Tách riêng cấu hình truyện dịch & tự viết" },
  { date: "28/05", title: "Nâng cấp từ vựng, độ mượt cho chế độ NSFW" },
  { date: "27/05", title: "Thêm công tắc NSFW (R-18) cho chế độ Rewrite" },
  { date: "27/05", title: "Tích hợp RAG Context tự động học tình tiết truyện" },
];

export function SupportAndChangelogDialog({
  open,
  onOpenChange,
}: SupportAndChangelogDialogProps) {
  const [showDonate, setShowDonate] = useState(false);

  useEffect(() => {
    if (!open) {
      setShowDonate(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden gap-0 rounded-xl border bg-background shadow-2xl">
        <DialogHeader className="p-6 pb-4 border-b bg-muted/20">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <MessageSquareIcon className="size-5 text-primary" />
            Hỗ trợ & Cập nhật
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            Xem các tính năng mới nhất hoặc báo cáo sự cố để chúng tôi hỗ trợ bạn tốt hơn.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="changelog" className="w-full">
          <div className="px-6 py-2 border-b bg-muted/10">
            <TabsList className="grid w-full grid-cols-2 h-9 p-1">
              <TabsTrigger value="changelog" className="flex items-center gap-2 text-xs font-medium">
                <HistoryIcon className="size-3.5" />
                Lịch sử cập nhật
              </TabsTrigger>
              <TabsTrigger value="support" className="flex items-center gap-2 text-xs font-medium">
                <BugIcon className="size-3.5" />
                Báo lỗi & Hỗ trợ
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="p-6">
            {/* Changelog Content */}
            <TabsContent value="changelog" className="mt-0 focus-visible:outline-none">
              <ScrollArea className="h-[280px] pr-4">
                <div className="space-y-5 pl-2">
                  {changelog.map((item, idx) => (
                    <div key={idx} className="relative pl-6 pb-1 group">
                      {/* Timeline dot and line */}
                      {idx !== changelog.length - 1 && (
                        <div className="absolute left-[7px] top-[14px] bottom-[-20px] w-[2px] bg-border group-hover:bg-primary/20 transition-colors" />
                      )}
                      <div className="absolute left-0 top-1.5 size-4 rounded-full border-2 border-primary bg-background flex items-center justify-center shadow-sm">
                        <div className="size-1.5 rounded-full bg-primary" />
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md w-max">
                          {item.date}
                        </span>
                        <h4 className="text-sm font-semibold text-foreground leading-snug">
                          {item.title}
                        </h4>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Support / Bug Report Content */}
            <TabsContent value="support" className="mt-0 focus-visible:outline-none space-y-4">
              {showDonate ? (
                <div className="flex flex-col items-center justify-center p-4 bg-muted/20 border border-dashed rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <h3 className="text-sm font-bold mb-1">Ủng hộ phát triển Thuyết Thư Các</h3>
                  <p className="text-xs text-muted-foreground text-center mb-4 max-w-sm leading-relaxed">
                    Cảm ơn sự đóng góp của bạn để duy trì hệ thống và nâng cấp nhiều tính năng mới!
                  </p>
                  <img
                    src="/mathanhtoan.png"
                    alt="Mã thanh toán QR"
                    className="max-w-[200px] h-auto rounded-lg shadow-md border bg-white p-2"
                  />
                  <div className="flex items-center gap-3 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8 px-4 cursor-pointer"
                      onClick={() => setShowDonate(false)}
                    >
                      Quay lại
                    </Button>
                    <Button
                      asChild
                      size="sm"
                      variant="default"
                      className="text-xs h-8 px-4 gap-1.5 cursor-pointer shadow-md"
                    >
                      <a href="/mathanhtoan.png" download="QR_Thanh_Toan.png">
                        <DownloadIcon className="size-3.5" />
                        Tải ảnh về
                      </a>
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                    Nếu bạn phát hiện bất kỳ lỗi nào hoặc muốn đề xuất thêm tính năng, vui lòng liên hệ ngay với đội ngũ hỗ trợ để được xử lý nhanh nhất có thể.
                  </div>

                  <div className="grid gap-3">
                    {/* Zalo Group Option */}
                    <div className="flex items-center justify-between p-4 rounded-xl border bg-card hover:bg-accent/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center">
                          <UsersIcon className="size-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-foreground">Nhóm Zalo hỗ trợ</span>
                          <span className="text-xs text-muted-foreground">Nhận phản hồi trực tiếp & nhanh nhất</span>
                        </div>
                      </div>
                      <Button asChild size="sm" variant="outline" className="gap-1 text-xs">
                        <a href="https://zalo.me/g/53swywolqkq95enm6t7d" target="_blank" rel="noreferrer">
                          Tham gia
                        </a>
                      </Button>
                    </div>

                    {/* Email Support Option */}
                    <div className="flex items-center justify-between p-4 rounded-xl border bg-card hover:bg-accent/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center">
                          <MailIcon className="size-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-foreground">Gửi Email Báo Lỗi</span>
                          <span className="text-xs text-muted-foreground">toimaymanqua@gmail.com</span>
                        </div>
                      </div>
                      <Button asChild size="sm" variant="default" className="gap-1 text-xs shadow-md">
                        <a href="mailto:toimaymanqua@gmail.com">
                          Gửi Email
                        </a>
                      </Button>
                    </div>

                    {/* Donate Option */}
                    <div className="flex items-center justify-between p-4 rounded-xl border bg-card hover:bg-accent/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-full bg-pink-500/10 text-pink-500 flex items-center justify-center">
                          <HeartIcon className="size-5" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-foreground">Ủng hộ phát triển (Donate)</span>
                          <span className="text-xs text-muted-foreground">Giúp Thuyết Thư Các ngày càng hoàn thiện</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        className="gap-1 text-xs bg-pink-500 hover:bg-pink-600 text-white shadow-md cursor-pointer"
                        onClick={() => setShowDonate(true)}
                      >
                        Donate
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
