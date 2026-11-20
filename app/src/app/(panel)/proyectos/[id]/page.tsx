import { notFound } from "next/navigation";
import { OwnedSummary } from "@/modules/project/ui/owned-summary";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) notFound();
  return <OwnedSummary id={id}/>;
}
