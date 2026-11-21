import type { Metadata } from "next";
import { Onboarding } from "@/modules/user-profile/ui/onboarding";

export const metadata: Metadata = { title: "Bienvenida · ObraCota" };

export default function Page() {
  return <Onboarding />;
}
