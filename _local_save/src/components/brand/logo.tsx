import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  textClassName?: string;
}

const sizeMap = {
  sm: { box: "h-7 w-7", text: "text-sm" },
  md: { box: "h-9 w-9", text: "text-base" },
  lg: { box: "h-12 w-12", text: "text-xl" },
  xl: { box: "h-16 w-16", text: "text-2xl" },
};

/**
 * TNO brand logo mark.
 * Uses the official PNG isotype from /public/tno-logo.png.
 * Orange on transparent — works on both light cards and the dark navy sidebar.
 */
export function Logo({ className, size = "md", showText = true, textClassName }: LogoProps) {
  const sizes = sizeMap[size];
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {/* Plain <img> keeps it simple in standalone Next output (no sharp needed) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/tno-logo.png"
        alt="TNO"
        className={cn("shrink-0 object-contain", sizes.box)}
      />
      {showText && (
        <div className={cn("flex flex-col leading-none", textClassName)}>
          <span className={cn("font-bold tracking-tight", sizes.text)}>Qore</span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--tno-orange))]">
            by TNO
          </span>
        </div>
      )}
    </div>
  );
}
