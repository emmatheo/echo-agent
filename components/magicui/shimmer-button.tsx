"use client";

import { motion } from "framer-motion";
import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * ShimmerButton — the house button. A gold "ribbon" sweeps across on hover,
 * and it dips on press. Variants: `primary` (filled gold), `ghost` (outline).
 */
type Variant = "primary" | "ghost";

interface ShimmerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const ShimmerButton = React.forwardRef<
  HTMLButtonElement,
  ShimmerButtonProps
>(function ShimmerButton(
  { className, variant = "primary", children, ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 overflow-hidden",
        "rounded-md px-5 py-3 text-sm font-semibold tracking-wide",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
        "transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "bg-gold text-ink hover:bg-goldbright"
          : "border border-line bg-transparent text-bone hover:border-gold/60 hover:text-goldbright",
        className,
      )}
      {...(props as React.ComponentProps<typeof motion.button>)}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 -z-0",
          "before:absolute before:inset-y-0 before:left-0 before:w-1/3",
          "before:-translate-x-[120%] before:skew-x-[-18deg] before:content-['']",
          "group-hover:before:animate-ribbon",
          variant === "primary" ? "before:bg-white/35" : "before:bg-gold/20",
        )}
      />
      <span className="relative z-10 inline-flex items-center gap-2">
        {children}
      </span>
    </motion.button>
  );
});
