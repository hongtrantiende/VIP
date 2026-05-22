import { enforceVipAccess } from "@/lib/vip-guard";

export const metadata = {
  title: "Phòng Đọc VIP - Thuyết Thư Các",
  description: "Phòng đọc VIP dành riêng cho thành viên cao cấp",
};

export default async function ReadingRoomLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Enforce server-side VIP authentication and authorization
  await enforceVipAccess();

  return <>{children}</>;
}
