import type { ReactNode } from "react";
import { Spinner } from "./spinner";

/**
 * A live status line: a turning icon and the words that say what is happening («Cargando
 * archivos…»). With `hidden` only screen readers get it, for places where skeletons already show
 * the wait. `busy={false}` keeps the line (and its live region) but drops the icon, for messages
 * that follow the wait in the same place.
 */
export function LoadingStatus({ children, hidden, busy = true, size = 14, className }: {
  children: ReactNode; hidden?: boolean; busy?: boolean; size?: number; className?: string;
}) {
  return <p role="status" className={"loading-status" + (className ? " " + className : "")} data-hidden={hidden || undefined}>
    {busy && !hidden && <Spinner size={size} />}<span>{children}</span>
  </p>;
}
