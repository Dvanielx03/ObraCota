import type { Metadata } from "next";
import { GuideIndex } from "@/modules/guide/ui/guide-cards";

export const metadata: Metadata = { title: "Guías · ObraCota" };

export default function Page() { return <GuideIndex/>; }
