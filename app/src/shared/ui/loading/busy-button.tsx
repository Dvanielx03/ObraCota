import type { ComponentPropsWithRef, ReactNode } from "react";
import { Spinner } from "./spinner";

type BusyButtonProps = ComponentPropsWithRef<"button"> & {
  /** While true the button is disabled, says `aria-busy` and shows the turning icon with `busyLabel`. */
  busy: boolean;
  /** What is happening, in the button's own words: «Subiendo original…», «Creando…». */
  busyLabel: ReactNode;
  /** Icon shown before the label when idle; the spinner takes its place while busy. */
  icon?: ReactNode;
  spinnerSize?: number;
};

/**
 * Button with the reference's processing state: disabled, `aria-busy`, a turning icon in place of its
 * own and a short text of the phase. It keeps every other prop (class, type, aria-label…).
 */
export function BusyButton({ busy, busyLabel, icon, spinnerSize = 16, disabled, children, className, ...rest }: BusyButtonProps) {
  return <button {...rest} className={"busy-button" + (className ? " " + className : "")} disabled={disabled || busy}
    aria-busy={busy || undefined} data-busy={busy || undefined}>
    {busy ? <><Spinner size={spinnerSize} />{busyLabel}</> : <>{icon}{children}</>}
  </button>;
}
