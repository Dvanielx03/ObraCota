/**
 * «Grabar» of RECORRIDO (H7): the canvas recorded with `MediaRecorder` into a WebM the browser downloads. Nothing
 * leaves the machine; the recording only holds what the canvas draws (no interface, no sound).
 */

/** Frames per second asked of the canvas; the walk draws only while something moves, so a still view adds none. */
export const RECORDING_FPS = 30;
/** A recording stops by itself after five minutes, so a forgotten one does not fill the memory. */
export const RECORDING_LIMIT_MS = 5 * 60_000;
const TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

/** The first WebM type this browser records, or undefined when it records none. */
export function recordingType(supported: (type: string) => boolean = (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)): string | undefined {
  return TYPES.find((type) => supported(type));
}

/** "1:05" for 65 s: minutes and seconds of a recording. */
export function recordingClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

/** "Duplex_A.ifc" at 21-11-2026 14:05 → "obracota-duplex-a-recorrido-20261121-1405.webm" */
export function recordingName(fileName: string, when: Date): string {
  const base = fileName.replace(/\.[^./\\]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "modelo";
  const pad = (value: number) => String(value).padStart(2, "0");
  return "obracota-" + base + "-recorrido-" + when.getFullYear() + pad(when.getMonth() + 1) + pad(when.getDate()) + "-" + pad(when.getHours()) + pad(when.getMinutes()) + ".webm";
}

export interface WalkRecording {
  /** Milliseconds since the recording started. */
  elapsed(): number;
  /** Stops the recording and resolves with the video, or rejects when the browser produced nothing. */
  stop(): Promise<Blob>;
}

/** Starts recording `stream` (the canvas track of `ViewerPort.stream`). The stream's tracks stop with the recording. */
export function startRecording(stream: MediaStream, type: string): WalkRecording {
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const parts: Blob[] = [];
  const started = performance.now();
  recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      const video = new Blob(parts, { type: type.split(";")[0] });
      if (video.size) resolve(video); else reject(new Error("El navegador no entregó ningún cuadro del recorrido."));
    };
    recorder.onerror = () => reject(new Error("El navegador detuvo la grabación."));
  });
  // A slice every second keeps the parts small and loses at most one second if the tab closes.
  recorder.start(1000);
  return {
    elapsed: () => performance.now() - started,
    stop() {
      if (recorder.state !== "inactive") recorder.stop();
      return finished;
    },
  };
}
