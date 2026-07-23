"use client";

import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * BorderBeam — rotating gold conic beam around a rounded panel.
 * Place inside a `relative` + `overflow-hidden` rounded container.
 */
export function BorderBeam({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 rounded-[inherit]", className)}
    >
      <span className="absolute inset-0 rounded-[inherit] p-px [mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] [mask-composite:exclude]">
        <span className="absolute inset-[-100%] animate-beam bg-[conic-gradient(from_0deg,transparent_0_70%,#C9A24B_85%,#E7C877_92%,transparent_100%)]" />
      </span>
    </span>
  );
}

/** AnimatedShinyText — subtle shine passing across text (the LIVE eyebrow). */
export function AnimatedShinyText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-clip-text text-transparent animate-shine",
        "bg-[linear-gradient(110deg,#8A8A93,45%,#EDEBE6,55%,#8A8A93)] bg-[length:200%_100%]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small pulsing "live" dot. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-2 w-2", className)}>
      <span className="absolute inline-flex h-full w-full animate-pulseDot rounded-full bg-gold" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-goldbright" />
    </span>
  );
}
