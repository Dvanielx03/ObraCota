import { CredentialsForm } from "@/modules/security/ui/credentials-form";
export default async function Page({searchParams}:{searchParams:Promise<{desde?:string}>}) { return <CredentialsForm assistant={(await searchParams).desde==="asistente"}/>; }
