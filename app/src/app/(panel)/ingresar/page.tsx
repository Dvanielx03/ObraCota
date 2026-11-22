import type { Metadata } from "next";
import { CredentialsForm } from "@/modules/security/ui/credentials-form";

export const metadata: Metadata = { title: "Ingresar · ObraCota" };
export default async function Page({searchParams}:{searchParams:Promise<{desde?:string}>}) { return <CredentialsForm assistant={(await searchParams).desde==="asistente"}/>; }
