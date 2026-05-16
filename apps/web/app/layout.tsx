import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { Header } from "../components/header";
import { MobileTabBar } from "../components/mobile-tab-bar";
import { MobileTabBarServer } from "../components/mobile-tab-bar-server";
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
  applicationName: "e-Sharevice",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "e-Sharevice",
    statusBarStyle: "default",
  },
  icons: {
    // SVG is auto-discovered from app/icon.svg; the apple-touch-icon
    // PNG lives in public/ and needs an explicit link tag here so iOS
    // home-screen install picks it up.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
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
        {/*
          Inline the critical SEO tags so they're in the initial SSR <head>,
          not streamed in via AsyncMetadataOutlet at the end of <body>.
          `export const dynamic = "force-dynamic"` above defers the Next 15
          metadata API, which leaves <title> + <meta name="description"> at
          the bottom of <body> until hydration — Lighthouse's static SEO
          audit doesn't see them there and drops the score 4 points. The
          duplicate tags get deduped by the browser; canonical source for
          dynamic per-page titles remains the metadata API.
        */}
        <title>e-Sharevice</title>
        <meta
          name="description"
          content="A community skill and item exchange."
        />
      </head>
      <body className="bg-bg text-fg pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {/*
          Skip-to-content link — first focusable element on every page.
          Hidden visually until it receives keyboard focus, at which point
          it appears as a high-contrast pill at the top of the viewport.
          Activating it programmatically focuses the main-content wrapper
          (tabIndex={-1} makes it focusable without joining the tab order).
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:border-accent focus:bg-bg focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent focus:shadow-lg"
        >
          Skip to content
        </a>
        <Suspense fallback={<HeaderSkeleton />}>
          <Header />
        </Suspense>
        <div id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </div>
        <Suspense fallback={<MobileTabBar />}>
          <MobileTabBarServer />
        </Suspense>
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
