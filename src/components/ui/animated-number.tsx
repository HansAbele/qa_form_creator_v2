"use client";

import { useEffect, useState } from "react";
import { animate, useMotionValue, useTransform, motion } from "motion/react";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}

/**
 * Smoothly counts up from 0 to `value` over `duration` seconds.
 * Uses a spring-like ease-out for a pleasant "settling" feel.
 */
export function AnimatedNumber({
  value,
  duration = 1.2,
  decimals = 0,
  suffix = "",
  prefix = "",
  className,
}: AnimatedNumberProps) {
  const motionValue = useMotionValue(0);
  const rounded = useTransform(motionValue, (latest) =>
    latest.toFixed(decimals),
  );
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.22, 1, 0.36, 1], // ease-out-quint
    });
    const unsub = rounded.on("change", (v) => setDisplay(v));
    return () => {
      controls.stop();
      unsub();
    };
  }, [value, duration, motionValue, rounded]);

  return (
    <motion.span
      className={className}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {prefix}
      {display}
      {suffix}
    </motion.span>
  );
}
