import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./utils";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg bg-bg-elevated border border-border shadow-sm overflow-hidden",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 sm:p-5", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";
