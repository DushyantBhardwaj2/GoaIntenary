"use client";
import { type ReactNode, useId, useRef, useEffect } from "react";
import { ShieldCheck, CheckCircle2, LoaderCircle } from "lucide-react";
export function SunMark({ className = "" }: { className?: string }) { return <svg className={className} viewBox="0 0 80 80" fill="none" aria-hidden="true"><circle cx="40" cy="40" r="15" fill="currentColor" />{Array.from({ length: 12 }, (_, i) => <path key={i} d="M40 5v10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" transform={`rotate(${i * 30} 40 40)`} />)}</svg>; }

export function CoastArt({ small = false }: { small?: boolean }) {
  return <div className={`coast-art ${small ? "small" : ""}`} aria-hidden="true"><span className="postcard-label">SLOW DAYS. GOOD PEOPLE.</span><div className="art-sun" /><svg viewBox="0 0 500 240" preserveAspectRatio="none"><path d="M-20 100C80 10 170 180 270 100S420 30 530 120V250H-20Z" fill="#20665f" /><path d="M-20 145C85 60 185 215 300 140S440 110 530 160" stroke="#f6e7c9" strokeWidth="2" fill="none" /><path d="M-20 164C85 79 185 234 300 159S440 129 530 179" stroke="#f6e7c9" strokeWidth="2" fill="none" /><path d="M-20 183C85 98 185 253 300 178S440 148 530 198" stroke="#f6e7c9" strokeWidth="2" fill="none" /></svg><span className="postcard-coordinate">15.2993° N &nbsp; 74.1240° E</span><div className="postmark">GOA<br /><span>TOGETHER</span></div></div>;
}

export function Notice({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "success" | "info" }) { return <div className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>{tone === "success" ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}<div>{children}</div></div>; }
export function Busy({ text = "One moment…" }: { text?: string }) { return <span className="busy"><LoaderCircle size={17} className="spinner" />{text}</span>; }


export function Dialog({ title, children, onClose, busy = false, className = "" }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; className?: string }) {
 const titleId = useId();
 const ref = useRef<HTMLDialogElement>(null);
 useEffect(() => { const previous = document.activeElement as HTMLElement | null; const element = ref.current; element?.showModal(); return () => { element?.close(); previous?.focus(); }; }, []);
 return <dialog ref={ref} className={`premium-dialog panel ${className}`} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><div className="dialog-top"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button></div>{children}</dialog>;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) { return <div className="empty-state"><SunMark /><h3>{title}</h3><div>{children}</div></div>; }
