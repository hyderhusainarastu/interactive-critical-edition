"use client";

import { useEffect, useState } from "react";

export function ScrollAwareHeader({ className, children }: { className: string; children: React.ReactNode }) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const update = () => setCompact(window.scrollY > 18);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return <header className={`${className} ${compact ? "header-compact" : ""}`}>{children}</header>;
}
