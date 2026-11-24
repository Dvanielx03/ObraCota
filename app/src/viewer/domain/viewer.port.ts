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
  /** In verified units (metres), so it can be walked on the ground of a scene around it even without a floor of its own. */
  sceneWalk?: boolean;
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
  /** The visible piece at the centre of the first-person camera. */
  walkTarget(): ElementInfo | null;
  walkHighlight(id: string | null, color?: string): void;
  walkMove(key:string,held:boolean):void;
  /**
   * A live video track of the canvas at up to `fps` frames per second (`HTMLCanvasElement.captureStream`), to record
   * the walk. Null when the browser cannot capture the canvas.
   */
  stream(fps:number):MediaStream|null;
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
  /**
   * Local preview of a finish on the exterior of the model (walls with Pset_*Common.IsExternal, or the
   * pieces seen first from outside) and of the daylight. Only the scene changes: the file, the server and
   * the captures' AI flow are untouched. `null` restores the model's own materials and light.
   */
  previewExteriorFinish(finish: ExteriorFinish | null): ExteriorPreview;
  /**
   * «Recorrer esta escena en 3D»: the scene of an Escena choice or of a generated option, built with real geometry
   * around the model (sun and sky of the time of day, fog or rain of the weather, ground and low-poly trees or
   * neighbours of the surroundings, tone mapping of the style). Local only, it also holds during the walk and
   * combines with the exterior finish preview. False on plans or with nothing open.
   */
  previewEnvironment(environment: SceneEnvironment): boolean;
  /** Back to the neutral viewer: the scene objects go and the light, fog and tone mapping are restored. */
  clearEnvironment(): void;
  /** The scene shown right now, or null. */
  currentEnvironment(): SceneEnvironment | null;
  /**
   * Opens a file. `source` is the stored version it came from: a DWG of ACIS solids then asks the server
   * for their mesh (GET …/versions/{version}/solids) and draws it with the lines.
   */
  open(file: File | null, signal: AbortSignal, status: (text: string) => void, source?: { project: string; version: string }): Promise<ModelInfo>;
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
export type ExteriorMaterial = "wood" | "concrete" | "steel" | "glass" | "stone" | "paint";
export type ExteriorTone = "light" | "medium" | "dark";
export type ExteriorLight = "morning" | "afternoon" | "night";
export type SceneTime = "morning" | "afternoon" | "night" | "sunrise" | "noon" | "golden" | "sunset" | "blue";
export type SceneWeather = "clear" | "partly" | "overcast" | "fog" | "rain" | "snow";
export type SceneSeason = "spring" | "summer" | "autumn" | "winter";
export type SceneSurroundings = "none" | "countryside" | "city" | "coast" | "mountain" | "forest" | "lake" | "river" | "desert" | "tropical" | "residential" | "garden";
export type SceneStyle = "photo" | "white-model" | "model" | "flat" | "watercolor" | "marker" | "pastel" | "collage" | "illustration" | "pencil" | "ink";
/** What the 3D scene shows; null keeps the viewer's own value of that aspect. */
export interface SceneEnvironment {
  time: SceneTime | null;
  weather: SceneWeather | null;
  season: SceneSeason | null;
  surroundings: SceneSurroundings | null;
  style: SceneStyle | null;
  people?: { count: number; silhouette: boolean };
}
export interface ExteriorFinish { material: ExteriorMaterial | null; tone: ExteriorTone | null; light: ExteriorLight | null }
/**
 * How many pieces took the finish and how they were found (declared IsExternal, rays from outside, none). `ids` are
 * their viewer ids, so «Guardar en el modelo» can name the same pieces in a model change.
 */
export interface ExteriorPreview { pieces: number; source: "pset" | "perimeter" | "sample" | "none"; ids?: string[] }
