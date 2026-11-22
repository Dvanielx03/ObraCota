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
  /**
   * Data URL of the canvas on the light capture background; the longest side is at most `maxSide` px
   * (1280 by default). A `maxSide` above the canvas size renders that one picture sharper (pixel ratio up to 3).
   */
  capture(format?:"png"|"jpeg",maxSide?:number): string;
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
  /**
   * Moves the camera to `pose`. With `duration` (ms) it travels there along a short curve; it jumps
   * instead when the person prefers reduced motion or nothing is framed yet. Any later camera action
   * (orbit, zoom, framing, another pose) stops a move in progress.
   */
  applyPose(pose: CameraPose, duration?: number): void;
  extents(): void;
  windowZoom(): void;
  /** Piece and 3D point under a position of the window (client px), or null over the background. */
  probe(clientX: number, clientY: number): ProbeHit | null;
  /**
   * Where 3D points fall on the canvas, in CSS px from its top-left corner. Null for a point that is
   * outside the view or hidden behind another part of the model; `owners` names the piece each
   * point lies on, so its own surface never hides it.
   */
  project(points: readonly (readonly [number, number, number])[], owners?: readonly (string | undefined)[]): ({ x: number; y: number } | null)[];
  /** Runs `listener` after every frame drawn (camera moves, resizes); returns the function that stops it. */
  onFrame(listener: () => void): () => void;
  /**
   * Marking mode of Editar › Seleccionar: the left button neither orbits nor picks (it draws marks),
   * the right button orbits and the middle one pans. The wheel still zooms.
   */
  setMarking(on: boolean): void;
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
/** What a click lands on: the piece (viewer id) and the 3D point of its surface. */
export interface ProbeHit { id: string; point: [number, number, number] }
export type ViewDirection = "front" | "back" | "right" | "left" | "top" | "bottom" | "iso";
