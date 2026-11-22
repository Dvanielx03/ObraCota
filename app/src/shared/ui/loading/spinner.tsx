import { Loader2 } from "lucide-react";

/**
 * Turning loader icon (lucide `Loader2`), one turn every 0.8 s, linear. Decorative: the words that go
 * with it carry the state. The size is set inline so button rules (`button svg`) cannot resize it.
 * With reduced motion it stays still.
 */
export function Spinner({ size = 16, strokeWidth = 2, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return <Loader2 className={"spinner" + (className ? " " + className : "")} size={size} strokeWidth={strokeWidth}
    style={{ width: size, height: size }} aria-hidden="true" focusable="false" />;
}
