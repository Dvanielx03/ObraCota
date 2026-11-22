"use client";
import { useId } from "react";

/**
 * Why a control is off, for keyboard and screen reader users too (KNOWN_ISSUES #14): the reason is
 * kept in a hidden node next to the control and linked with `aria-describedby`, so it is read when
 * the control takes focus instead of living only in the pointer tooltip. Render `note` as a sibling
 * of the control, never inside it, or it would become part of the control's name.
 */
export function useDisabledReason(reason: string | undefined, describedBy?: string) {
  const id = useId();
  return {
    describedBy: reason ? [describedBy, id].filter(Boolean).join(" ") : describedBy,
    note: reason ? <span id={id} hidden>{reason}</span> : null,
  };
}
