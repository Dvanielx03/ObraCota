import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Panel de proyectos · ObraCota", description: "Proyectos, archivos y modelos de ObraCota" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body>{children}</body></html>;
}
