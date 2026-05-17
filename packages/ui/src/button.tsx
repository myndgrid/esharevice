import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

/**
 * Variant taxonomy per the marketplace redesign:
 *   brand  — solid sky-500. Primary CTAs (Request, Buy now, Continue, Submit).
 *   ghost  — outlined neutral. Secondary actions (Message, Back, Cancel, Edit).
 *   accent — solid amber-500. Reserved for accent-led affordances; rarely a button.
 *   ink    — solid near-black. Admin/system actions, dense filtering controls.
 *   danger — solid red. Destructive confirms.
 *   link   — inline text affordance; brand-coloured.
 *
 * Hover/pressed states reach for `--brand-h` / `--brand-p` rather than
 * `opacity-90` so dark mode + reduced-motion both keep clear contrast.
 */
const buttonStyles = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium",
    "transition-[background-color,color,box-shadow,border-color] duration-150 ease-out",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        brand: "bg-brand text-brand-fg hover:bg-brand-h active:bg-brand-p",
        ghost:
          "bg-bg text-fg border border-border hover:bg-bg-subtle hover:border-border-strong",
        accent: "bg-accent text-accent-fg hover:bg-accent-h",
        ink: "bg-fg text-bg hover:bg-fg/90",
        danger: "bg-danger text-white hover:opacity-90",
        link: "bg-transparent text-brand underline-offset-4 hover:underline px-0",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-5 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "brand", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonStyles({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
