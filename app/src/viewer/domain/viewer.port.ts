export interface ElementInfo {
  id: string;
  name: string;
  level: string;
  type: string;
  guid?: string;
  material?: string;
  evidence?: {unit:string;width:number|null;height:number|null;extents:number[]; finishes:{value:string;source:string}[];widths:{value:number;source:string}[]};
  count?: number;
  cad?: {types:Record<string,number>;min:number[];max:number[]};
  annotation?: {handle:string; raw:string; position:[number,number,number]; anchor:[number,number,number]; height:number};
  dimension?: {kind:string;value:number;style:string;endpoints:number[]};
}
export interface ModelInfo {
  environment?: "plan"|"model";
  versionId?:string;
  drawing?: {units:string; depth:number; omissions:string};
  name: string;
  schema: string;
  walk?: boolean;
  sample: boolean;
  elements: ElementInfo[];
}
export interface ViewerPort {
  capture(format?:"png"|"jpeg"): string;
  previewGroup(ids:string[],color?:string):void;
  frameGroup(ids:string[]):void;
  captureGroup(ids:string[],format?:"png"|"jpeg",view?:GroupCaptureView):GroupCapture;
  enterWalk(mark:(result:string|null)=>void):void;
  cancelWalk():void;
  switchWalk(file:File,signal:AbortSignal,status:(text:string)=>void):Promise<void>;
  walkMove(key:string,held:boolean):void;
  orient(view: ViewDirection): void;
  /** Camera of the 3D view, or null while it cannot be read (plans, walking, nothing open). */
  pose(): CameraPose | null;
  applyPose(pose: CameraPose): void;
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
/** Where the camera is, what it looks at and how tall the visible area is, in model units. */
export interface CameraPose { position: [number, number, number]; target: [number, number, number]; span: number }
export interface GroupCapture {
  image:string;
  mask:string;
  missing:number;
  width:number;
  height:number;
}
export type GroupCaptureView="current"|"reframe"|"isolated";
export type ViewDirection = "front" | "back" | "right" | "left" | "top" | "bottom" | "iso";
