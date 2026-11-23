/**
 * What the viewer could still show about a file it could not open: the thumbnail AutoCAD keeps inside
 * a DWG whose model space holds only ACIS solids, or the version (and picture, when useful) of a Revit
 * RVT. The workspace shows the failure as text; this small store lets the card that tells it add the
 * details, matched by the same message so a later, different failure never shows stale ones.
 */
export interface OpenFailure {
  /** The message the viewer rejected with (the card's text). */
  message: string;
  file: string;
  /** Why nothing could be drawn: a model of ACIS solids (with the mesh hint) or a Revit original. */
  reason: "acis" | "revit";
  /** Object URL of the stored thumbnail (PNG or BMP), revoked when the next open starts. */
  preview?: string;
  /** "PNG" or "BMP": how the file stores it. */
  kind: string;
  /** True when the uniform margin of the stored picture was cropped away. */
  cropped?: boolean;
  /** Revit release and build that saved an RVT ("2025", "20240715_1515(x64)"), and whether it is a stored version. */
  revit?: { release?: string; build?: string; stored: boolean };
}

let current: OpenFailure | null = null;
const listeners = new Set<() => void>();
function emit() { for (const listener of listeners) listener(); }
function revoke(failure: OpenFailure | null) { if (failure?.preview) URL.revokeObjectURL(failure.preview); }

export const openFailures = {
  current: (): OpenFailure | null => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  report(next: OpenFailure) {
    revoke(current);
    current = next; emit();
  },
  clear() {
    if (!current) return;
    revoke(current);
    current = null; emit();
  },
};
