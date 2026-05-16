import { api } from "../lib/api";
import { auth } from "../lib/auth";
import { MobileTabBar } from "./mobile-tab-bar";

/**
 * Server wrapper that resolves the unread-messages count for the
 * authenticated viewer and hands it to the client tab bar. Unauthed
 * visitors see the bar with no badge; an API failure also degrades
 * silently to "no badge" — the navigation must never break because
 * the count couldn't be fetched.
 *
 * Suspense-wrapped at the layout level so a slow API response doesn't
 * delay the rest of the page's first paint.
 */
export async function MobileTabBarServer(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.access_token) return <MobileTabBar />;

  try {
    const { total } = await api.unreadMessageCount();
    return <MobileTabBar unreadMessages={total} />;
  } catch {
    return <MobileTabBar />;
  }
}
