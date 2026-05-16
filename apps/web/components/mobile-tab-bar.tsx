"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

type Tab = {
  href: Route;
  label: string;
  icon: React.ReactNode;
  // A tab is "active" if the current pathname starts with this prefix.
  // The home tab matches `/` exactly to avoid catching every page.
  exact?: boolean;
};

const TABS: readonly Tab[] = [
  { href: "/", label: "Home", icon: <HomeIcon />, exact: true },
  { href: "/saved", label: "Saved", icon: <BookmarkIcon /> },
  { href: "/messages", label: "Messages", icon: <ChatIcon /> },
  { href: "/profile", label: "Profile", icon: <UserIcon /> },
] as const;

export function MobileTabBar(): React.ReactElement {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85 md:hidden"
      // env() safe-area-inset-bottom so the bar sits above the iOS home
      // indicator without clipping content.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex h-14 min-w-12 flex-col items-center justify-center gap-0.5 text-xs " +
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg " +
                  (active ? "text-accent" : "text-fg-muted hover:text-fg")
                }
              >
                <span aria-hidden className="grid place-items-center">
                  {tab.icon}
                </span>
                <span className="text-[10px] font-medium leading-none">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─────────────────────────────── icons (inline SVG, no extra dep)
// Sized at 22px; current-color so they inherit the tab's text color.

function HomeIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

function BookmarkIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h12v17l-6-3.5L6 21z" />
    </svg>
  );
}

function ChatIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function UserIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}
