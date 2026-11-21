"use client";
import { createContext } from "react";
import type { VersionNotes } from "@/modules/model-version/domain/model-version";

export const NotesContext = createContext<VersionNotes | undefined>(undefined);

export function localNotes(version: string): VersionNotes {
  const prefix="obracota.review.v1."+version+".";
  return {
    async load() {
      return Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith(prefix))
        .map(k=>[k.slice(prefix.length),localStorage.getItem(k) || ""]));
    },
    async save(key,text) {
      if (text) localStorage.setItem(prefix+key,text); else localStorage.removeItem(prefix+key);
    },
  };
}
