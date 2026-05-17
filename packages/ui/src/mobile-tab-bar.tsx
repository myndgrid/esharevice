import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

export type MobileTabBarTab = {
  /** Stable identifier (route slug). */
  key: string;
  /** Label rendered under the icon. */
  label: string;
  /** Icon element (24×24 recommended). */
  icon: ReactNode;
  /** Optional unread/notification dot count. */
  badge?: number;
  /** Tap handler — usually navigates. */
  onSelect?: () => void;
};

export type MobileTabBarProps = HTMLAttributes<HTMLElement> & {
  tabs: MobileTabBarTab[];
  /** Active tab key. */
  active?: string;
};

/**
 * 5-tab bottom navigation for mobile surfaces. Pinned to the bottom of the
 * viewport via `position: fixed` on the consumer side — this primitive
 * doesn't position itself so layouts can compose it inside a portal or a
 * regular div without surprise.
 *
 * Accessibility: rendered as a <nav> with each tab a real <button>. Active
 * tab carries `aria-current="page"`.
 */
export const MobileTabBar = forwardRef<HTMLElement, MobileTabBarProps>(
  ({ tabs, active, className, ...props }, ref) => (
    <nav
      ref={ref}
      aria-label="Primary"
      className={cn(
        "flex w-full items-stretch border-t border-border bg-bg/95 backdrop-blur",
        // safe-area-inset-bottom for iPhone home-indicator clearance
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
      {...props}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={tab.onSelect}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              isActive ? "text-[var(--brand-deep)]" : "text-fg-muted hover:text-fg",
            )}
          >
            <span className="relative h-6 w-6">
              {tab.icon}
              {typeof tab.badge === "number" && tab.badge > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1.5 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-bold leading-none text-brand-fg"
                >
                  {tab.badge > 99 ? "99+" : tab.badge}
                </span>
              ) : null}
            </span>
            <span className="whitespace-nowrap">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  ),
);
MobileTabBar.displayName = "MobileTabBar";
