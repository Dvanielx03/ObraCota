import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Manrope } from "next/font/google";

import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { ScrollSuave } from "@/components/site/scroll-suave";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas",
  display: "swap",
});

const SITIO = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITIO),
  title: {
    default: "ObraCota · Del terreno a la obra",
    template: "%s · ObraCota",
  },
  description:
    "ObraCota coordina planos, modelos BIM y avance de obra en un solo proyecto. Cada respuesta cita su lámina y su página. Solicita una demostración.",
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "ObraCota",
    title: "ObraCota · Del terreno a la obra",
    description:
      "Coordina planos, modelos BIM y avance de obra en un solo proyecto. Cada respuesta cita su lámina y su página.",
    images: [{ url: "/images/og.jpg", width: 1200, height: 630, alt: "Pabellón de dos pisos al anochecer con el nombre ObraCota" }],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0a1522",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${manrope.variable} ${bebas.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#contenido"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[60] focus-visible:rounded-full focus-visible:bg-bone focus-visible:px-5 focus-visible:py-3 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-ink"
        >
          Saltar al contenido
        </a>
        <ScrollSuave />
        <SiteHeader />
        <main id="contenido" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
