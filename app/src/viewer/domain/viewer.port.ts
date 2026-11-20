export interface ElementInfo {
  id: string;
  name: string;
  level: string;
  type: string;
  guid?: string;
  material?: string;
  count?: number;
  annotation?: {handle:string; raw:string; position:[number,number,number]; anchor:[number,number,number]; height:number};
  dimension?: {kind:string;value:number;style:string;endpoints:number[]};
}
export interface ModelInfo {
  environment?: "plan"|"model";
  versionId?:string;
  drawing?: {units:string; depth:number; omissions:string};
  name: string;
  schema: string;
  sample: boolean;
  elements: ElementInfo[];
}
export interface ViewerPort {
  orient(view: ViewDirection): void;
  extents(): void;
  windowZoom(): void;
  open(file: File | null, signal: AbortSignal, status: (text: string) => void): Promise<ModelInfo>;
  select(id: string | null): void;
  locate(id: string): void;
  fit(): void;
  clear(): void;
  zoom(factor: number): void;
  pan(enabled: boolean): void;
  dispose(): void;
}
export type ViewDirection = "front" | "back" | "right" | "left" | "top" | "bottom" | "iso";
