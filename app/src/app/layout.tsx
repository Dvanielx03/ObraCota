import "./theme.css";
import "./globals.css";
import "@/shared/ui/loading/loading.css";
import type { Metadata, Viewport } from "next";
import { themeScript } from "@/shared/theme/theme-script";
// Pages set their own title; project pages and the viewer complete it once the names are known.
export const metadata: Metadata = { title: "ObraCota", description: "Proyectos, archivos y modelos de ObraCota" };
// Browser chrome follows the page colour (--bg of theme.css). icon.svg and apple-icon.png sit next to this file.
export const viewport: Viewport = { themeColor: [
  { media: "(prefers-color-scheme: light)", color: "#F3F2F1" },
  { media: "(prefers-color-scheme: dark)", color: "#1D2026" },
] };
export default function Layout({ children }: { children: React.ReactNode }) {
  // The head script writes data-theme before hydration, hence the suppressed warning on <html>.
  return <html lang="es" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }}/></head><body>{children}</body></html>;
}
