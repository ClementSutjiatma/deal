import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/client-providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Deal - Safe Ticket Escrow",
  description:
    "AI-powered escrow for peer-to-peer ticket sales. Share a link. First to deposit wins.",
  other: {
    "base:app_id": "699640eb7b16c9a7e63e972b",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${inter.className} antialiased bg-white text-zinc-900`}
      >
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
