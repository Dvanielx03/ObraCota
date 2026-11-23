import type { Metadata } from "next";
import { CredentialsForm } from "@/modules/security/ui/credentials-form";

export const metadata: Metadata = { title: "Ingresar · ObraCota" };
export default async function Page({searchParams}:{searchParams:Promise<{desde?:string}>}) {
  return <CredentialsForm from={(await searchParams).desde} siteUrl={process.env.NEXT_PUBLIC_SITE_URL}/>;
}
