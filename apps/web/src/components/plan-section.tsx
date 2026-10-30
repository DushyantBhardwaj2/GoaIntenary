"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import styles from "./plan-section.module.css";

function FoldButton({ open, panelId, label, overlay, onClick }: {
  open: boolean;
  panelId: string;
  label: string;
  overlay?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={overlay ? `${styles.toggle} ${styles.overlay}` : styles.toggle}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`${open ? "Minimize" : "Expand"} ${label}`}
      onClick={onClick}
    >
      {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
      <span>{open ? "Minimize" : "Expand"}</span>
    </button>
  );
}

export function PlanSection({ title, summary, summaryId, kicker, expand, children, defaultOpen = true, onOpenChange }: {
  title: string;
  summary: string;
  summaryId?: string;
  kicker?: string;
  /** Keep the detail open while a retryable error is showing. */
  expand?: boolean;
  children: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const storageKey = `goa-plan-section:${title}`;
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const titleId = useId();
  useEffect(() => {
    try {
      // Lazy sections start closed on each visit; opening them is the fetch trigger.
      if (defaultOpen && window.localStorage.getItem(storageKey) === "closed") setOpen(false);
    } catch {
      /* Private browsing can block storage. The section stays open. */
    }
  }, [storageKey, defaultOpen]);
  useEffect(() => {
    if (expand) setOpen(true);
  }, [expand]);
  const shown = open || Boolean(expand);
  useEffect(() => { onOpenChange?.(shown); }, [onOpenChange, shown]);
  const toggle = () => {
    setOpen((value) => {
      const next = !value;
      try { window.localStorage.setItem(storageKey, next ? "open" : "closed"); } catch { /* ignore */ }
      return next;
    });
  };
  return (
    <section className={styles.block} aria-labelledby={titleId}>
      <div className={styles.header}>
        <div className={styles.copy}>
          {kicker ? <p className={styles.kicker}>{kicker}</p> : null}
          <h3 id={titleId} className={styles.title}>{title}</h3>
          <p id={summaryId} className={styles.summary}>{summary}</p>
        </div>
        <FoldButton open={shown} panelId={panelId} label={title} onClick={toggle} />
      </div>
      <div id={panelId} className={styles.detail} hidden={!shown}>
        {children}
      </div>
    </section>
  );
}

/** Keeps an existing section header visible and folds the rest. */
export function PlanFold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  return (
    <div className={styles.fold} data-open={open ? "true" : "false"}>
      <FoldButton open={open} panelId={panelId} label={label} overlay onClick={() => setOpen((value) => !value)} />
      <div id={panelId}>{children}</div>
    </div>
  );
}
