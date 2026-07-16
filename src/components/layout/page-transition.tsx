"use client";

import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Applies a short entrance transition whenever the pathname changes.
 *
 * Next App Router owns the route segment lifecycle. Keeping its outgoing
 * children mounted with AnimatePresence can restore stale interactive content
 * after the new segment has rendered, so route replacement remains atomic and
 * only the incoming segment is animated here.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        ease: [0.22, 1, 0.36, 1], // ease-out-quint
      }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}
