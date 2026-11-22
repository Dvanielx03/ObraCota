import type { Metadata } from "next";
import { CredentialsForm } from "@/modules/security/ui/credentials-form";

export const metadata: Metadata = { title: "Crear cuenta · ObraCota" };
export default async function Page({searchParams}:{searchParams:Promise<{desde?:string}>}) { return <CredentialsForm registration assistant={(await searchParams).desde==="asistente"}/>; }
