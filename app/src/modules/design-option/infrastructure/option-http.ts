"use client";
import { authenticated, authenticatedResponse } from "@/core/http/http-client";
import type { OptionHistory } from "../domain/option-history";

/** Base path of the options of one model version. */
export const optionsPath = (project: string, version: string) => "projects/" + project + "/versions/" + version + "/options";
export const optionImagePath = (base: string, batch: string, slot: number) => base + "/" + batch + "/images/" + slot;

export function listOptions(base: string, key: string, signal?: AbortSignal): Promise<OptionHistory> {
  return authenticated<OptionHistory>(base + "?element=" + encodeURIComponent(key), { signal });
}

export interface OptionRequest { id: string; element: string; name: string; request: string; jpeg: string; mask?: string }
export function requestOptions(base: string, body: OptionRequest): Promise<unknown> {
  return authenticated(base, { method: "POST", body: JSON.stringify(body) });
}

export function chooseOption(base: string, batch: string, slot: number): Promise<unknown> {
  return authenticated(base + "/" + batch + "/selection/" + slot, { method: "PUT" });
}

export async function optionImage(path: string, signal?: AbortSignal): Promise<Blob> {
  return (await authenticatedResponse(path, { signal })).blob();
}

/** «Panorama 360° con IA»: a 2:1 equirectangular picture of the scene, generated on the server and kept only in memory here. */
export interface PanoramaRequest { scene: string; jpeg?: string }
export async function requestPanorama(base: string, body: PanoramaRequest, signal?: AbortSignal): Promise<Blob> {
  return (await authenticatedResponse(base + "/panorama", { method: "POST", body: JSON.stringify(body), signal })).blob();
}
