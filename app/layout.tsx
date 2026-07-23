import type { Metadata } from "next";
import { Anton, Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";

/**
 * Strict, deliberate type system (loaded via next/font, not CDN-guessed):
 *  - Anton        -> poster display (condensed, uppercase headlines)
 *  - Inter        -> all UI + body copy
 *  - Roboto Mono  -> scores, xG, USDC — the "data" voice
 * Prefer a lighter display face? Swap Anton for Oswald here.
 */
const display = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Echo Agent — Football Intelligence on Injective",
  description:
    "Chat with an autonomous football analyst. Free basics; detailed analysis paid per-request in USDC via x402 on Injective EVM.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
