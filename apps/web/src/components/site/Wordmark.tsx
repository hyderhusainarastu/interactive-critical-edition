"use client";

import Link from "next/link";
import { Mark } from "./Mark";

export function Wordmark({ href, small = true, className = "" }: { href: string; small?: boolean; className?: string }) {
  return <Link href={href} data-sound="click" className={`wordmark ${className}`} aria-label="Palimnote home"><Mark small={small} /><span aria-hidden="true">{"Palimnote".split("").map((letter, index) => <span key={`${letter}-${index}`} className="wordmark-letter" style={{ "--wordmark-index": index } as React.CSSProperties}>{letter}</span>)}</span></Link>;
}
