import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond, Geist_Mono, Manrope } from "next/font/google";
import { SmoothScroll } from "@/components/providers/smooth-scroll";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { themeInitScript } from "@/lib/theme-script";
import "./globals.css";

// Display: high-contrast Garamond for headlines. Regal: engraved Roman capitals for eyebrows.
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LinkRoom — Every link, read together",
  description:
    "Turn any link or PDF into a live multiplayer room. Read, highlight and discuss together, with an AI recap for the whole group.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${cormorant.variable} ${cinzel.variable} ${manrope.variable} ${geistMono.variable} antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/* Extensions such as ColorZilla inject attributes on <body> before React hydrates. */}
      <body className="grain min-h-dvh" suppressHydrationWarning>
        <SmoothScroll>
          <TooltipProvider>{children}</TooltipProvider>
        </SmoothScroll>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
