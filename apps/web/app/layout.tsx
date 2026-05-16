import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { Header } from "../components/header";
import { MobileTabBar } from "../components/mobile-tab-bar";
import "./globals.css";

// Force dynamic rendering site-wide. The auth-aware <Header> reads cookies()
// via auth(), which already triggers dynamic rendering for the *layout* — but
// pages composed under this layout could otherwise be statically generated
// with a stale unauthenticated header. Belt + suspenders.
export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "e-Sharevice",
  description: "A community skill and item exchange.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "oklch(99% 0 0)" },
    { media: "(prefers-color-scheme: dark)", color: "oklch(15% 0.015 260)" },
  ],
};

const themeBootstrap = `
  (function () {
    try {
      var saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
      }
    } catch (e) {}
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="bg-bg text-fg pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <Suspense fallback={<HeaderSkeleton />}>
          <Header />
        </Suspense>
        {children}
        <MobileTabBar />
      </body>
    </html>
  );
}

function HeaderSkeleton(): React.ReactElement {
  return (
    <div className="sticky top-0 z-40 w-full border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto h-14 max-w-5xl px-4" />
    </div>
  );
}
