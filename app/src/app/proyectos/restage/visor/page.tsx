import { ViewerWorkspace } from "@/modules/model-file/ui/viewer-workspace";

export default async function Page({ searchParams }: { searchParams: Promise<{ desde?: string }> }) {
  const { desde } = await searchParams;
  if (desde === "recorrido" && process.env.NEXT_PUBLIC_SITE_URL) {
    return <ViewerWorkspace returnHref={process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "") + "/#recorrido"} returnLabel="Volver al recorrido"/>;
  }
  const origin = desde === "archivos" || desde === "cambios" ? "/" + desde : "";
  return <ViewerWorkspace returnHref={"/proyectos/restage" + origin}/>;
}
