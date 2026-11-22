/**
 * What the viewer could still show about a file it could not open: today, the thumbnail AutoCAD keeps
 * inside a DWG whose model space holds only ACIS solids. The workspace shows the failure as text; this
 * small store lets the card that tells it add the picture, matched by the same message so a later,
 * different failure never shows a stale thumbnail.
 */
export interface OpenFailure {
  /** The message the viewer rejected with (the card's text). */
  message: string;
  file: string;
  /** Why nothing could be drawn. Only a model of ACIS solids carries a picture and the mesh hint. */
  reason: "acis";
  /** Object URL of the stored thumbnail (PNG or BMP), revoked when the next open starts. */
  preview: string;
  /** "PNG" or "BMP": how the DWG stores it. */
  kind: string;
  /** True when the uniform margin of the stored picture was cropped away. */
  cropped?: boolean;
}

let current: OpenFailure | null = null;
const listeners = new Set<() => void>();
function emit() { for (const listener of listeners) listener(); }

export const openFailures = {
  current: (): OpenFailure | null => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  report(next: OpenFailure) {
    if (current) URL.revokeObjectURL(current.preview);
    current = next; emit();
  },
  clear() {
    if (!current) return;
    URL.revokeObjectURL(current.preview);
    current = null; emit();
  },
};
