import type { CSSProperties } from "react";

/** Common placeholder shapes; anything else is sized with `style` or a class. */
export type SkeletonShape = "block" | "line" | "circle" | "thumb" | "card";

/**
 * Grey placeholder with the reference's 2 s pulse (`animate-pulse`, opacity 1 → .5 → 1 on
 * `cubic-bezier(.4,0,.6,1)`). Always hidden from assistive technology: the region that holds it
 * carries `aria-busy` and a status text (see `LoadingStatus`). Still with reduced motion.
 */
export function Skeleton({ shape = "block", width, height, className, style }: {
  shape?: SkeletonShape; width?: number | string; height?: number | string; className?: string; style?: CSSProperties;
}) {
  return <span className={"skeleton" + (className ? " " + className : "")} data-shape={shape} aria-hidden="true"
    style={{ width, height, ...style }} />;
}

/** A column of text-like bars: the last one shorter, as a paragraph ends. */
export function SkeletonLines({ count = 3, className }: { count?: number; className?: string }) {
  return <span className={"skeleton-lines" + (className ? " " + className : "")} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <Skeleton key={index} shape="line" width={index === count - 1 && count > 1 ? "62%" : undefined} />)}
  </span>;
}
