import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findGuide, guides } from "@/modules/guide/domain/guides";
import { GuideDetail } from "@/modules/guide/ui/guide-cards";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() { return guides.map(guide => ({ slug: guide.slug })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = findGuide((await params).slug);
  return { title: (guide ? guide.title : "Guía") + " · ObraCota" };
}

export default async function Page({ params }: Props) {
  const guide = findGuide((await params).slug);
  if (!guide) notFound();
  return <GuideDetail guide={guide}/>;
}
