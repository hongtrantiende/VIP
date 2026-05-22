import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { JetBrains_Mono, Open_Sans, Playfair_Display, Literata, Lora } from "next/font/google";
import "./globals.css";
import { NavigationProgress } from "@/components/navigation-progress";

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

export const metadata: Metadata = {
  title: "Thuyết Thư Các",
  description: "Kho tàng truyện chữ online",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${openSans.variable} ${playfair.variable} ${jetbrainsMono.variable} ${literata.variable} ${lora.variable} h-full antialiased`}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <TooltipProvider>
          <NavigationProgress />
          {children}
        </TooltipProvider>
        <Toaster position="top-center" richColors />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
