import { enforceVipAccess } from "@/lib/vip-guard";

export const metadata = {
  title: "Độc Giả - Thuyết Thư Các",
  description: "Trình đọc truyện VIP dành riêng cho thành viên",
};

export default async function ReaderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Enforce server-side VIP authentication and authorization for reader sub-routes
  await enforceVipAccess();

  return <>{children}</>;
}
