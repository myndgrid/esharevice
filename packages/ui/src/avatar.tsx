import { useMemo, type HTMLAttributes } from "react";
import { cn } from "./utils";

export type AvatarProps = HTMLAttributes<HTMLDivElement> & {
  /** Display name — used to derive initials when no `src` */
  name?: string | undefined;
  src?: string | undefined;
  alt?: string | undefined;
  size?: "sm" | "md" | "lg";
};

const SIZES: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
};

function initials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function Avatar({
  name,
  src,
  alt,
  size = "md",
  className,
  ...rest
}: AvatarProps) {
  const label = useMemo(() => initials(name), [name]);
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-bg-subtle text-fg-muted font-medium overflow-hidden select-none",
        SIZES[size],
        className,
      )}
      aria-label={alt ?? name ?? "avatar"}
      {...rest}
    >
      {src ? (
        // packages/ui is framework-agnostic — consumers (web app) may
        // wrap with next/image if they care about LCP. Plain <img> here.
        <img src={src} alt={alt ?? name ?? ""} className="size-full object-cover" />
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}
