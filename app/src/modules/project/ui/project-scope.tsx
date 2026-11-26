"use client";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/core/auth/use-session";
import { HttpError } from "@/core/http/http-client";
import { fileCatalog } from "@/modules/model-file/infrastructure/file-catalog";
import { versionRepository } from "@/modules/model-version/infrastructure/version-http";
import { projectRoute, type ProjectRoute } from "@/shared/ui/panel-routes";
import { getProject, renameProject } from "../application/manage-projects";
import { projectOverview, type ProjectOverview } from "../application/project-overview";
import type { OwnedProject } from "../domain/owned-project";
import type { Project } from "../domain/project";
import { projectHttpRepository } from "../infrastructure/project-http-repository";

export type OwnedStatus =
  | { status: "session" }
  | { status: "guest" }
  | { status: "loading" }
  | { status: "ready"; project: OwnedProject }
  | { status: "missing" }
  | { status: "error" };

export type OverviewStatus = { status: "loading" } | { status: "error" } | ({ status: "ready" } & ProjectOverview);

export type ProjectScopeValue =
  | { kind: "example"; route: ProjectRoute; project: Project }
  | {
    kind: "owned"; route: ProjectRoute; owned: OwnedStatus; overview: OverviewStatus;
    retry(): void;
    /** Saves a new name; rejects with a message the interface can show. */
    rename(name: string): Promise<void>;
  };

const Scope = createContext<ProjectScopeValue | null>(null);

/** Project of the current panel route, shared by the project bar and the section pages. */
export function useProjectScope() { return useContext(Scope); }

function OwnedScope({ route, children }: { route: ProjectRoute; children: ReactNode }) {
  const { session, failed } = useSession();
  const [owned, setOwned] = useState<OwnedStatus>({ status: "loading" });
  const [overview, setOverview] = useState<OverviewStatus>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Bumped when «Archivos y versiones» stores a version, so the «Visor» tab enables itself without leaving the page.
  const [stored, setStored] = useState(0);
  useEffect(() => {
    const saved = () => setStored(value => value + 1);
    window.addEventListener("obracota:version-saved", saved);
    return () => window.removeEventListener("obracota:version-saved", saved);
  }, []);
  const email = session?.email;
  useEffect(() => {
    if (!email) return;
    let live = true;
    getProject(projectHttpRepository, route.id)
      .then(project => { if (live) setOwned({ status: "ready", project }); })
      .catch(error => { if (live) setOwned({ status: error instanceof HttpError && error.status === 404 ? "missing" : "error" }); });
    return () => { live = false; };
  }, [email, route.id, attempt]);
  // The newest version feeds the "Visor" tab; it is read again on every section change because
  // "Archivos y versiones" may have stored a new one.
  useEffect(() => {
    if (!email) return;
    let live = true;
    projectOverview(fileCatalog, versionRepository, route.id)
      .then(result => { if (live) setOverview({ status: "ready", ...result }); })
      .catch(() => { if (live) setOverview({ status: "error" }); });
    return () => { live = false; };
  }, [email, route.id, route.section, attempt, stored]);
  const rename = useCallback(async (name: string) => {
    const saved = await renameProject(projectHttpRepository, route.id, name);
    setOwned({ status: "ready", project: saved });
  }, [route.id]);
  const retry = useCallback(() => { setOwned({ status: "loading" }); setOverview({ status: "loading" }); setAttempt(value => value + 1); }, []);
  const state: OwnedStatus = session === null ? { status: "guest" } : session === undefined ? (failed ? { status: "error" } : { status: "session" }) : owned;
  return <Scope.Provider value={{ kind: "owned", route, owned: state, overview, retry, rename }}>{children}</Scope.Provider>;
}

/**
 * Provider placed in the panel layout. Outside a project it provides nothing; inside one it loads
 * the project once per project (not once per tab) and keeps it while the person moves between tabs.
 */
export function ProjectScope({ examples, children }: { examples: readonly Project[]; children: ReactNode }) {
  const route = projectRoute(usePathname());
  if (!route) return <Scope.Provider value={null}>{children}</Scope.Provider>;
  if (route.example) {
    const project = examples.find(item => item.slug === route.id);
    return <Scope.Provider value={project ? { kind: "example", route, project } : null}>{children}</Scope.Provider>;
  }
  return <OwnedScope key={route.id} route={route}>{children}</OwnedScope>;
}
