import type { Metadata } from "next";
import "./globals.css";
import { SupabaseProvider } from "@/components/providers/SupabaseProvider";

export const metadata: Metadata = {
  title: "Atoms",
  description: "Atoms 前端应用"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
