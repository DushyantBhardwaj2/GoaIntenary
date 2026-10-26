"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TubeScene } from './tube-engine';
import styles from './effects.module.css';

const GOA_PALETTE = ['#173F35', '#245B49', '#91AAA0', '#DE6C4E', '#E8D9B4'] as const;
export interface TubesBackgroundProps { children?: ReactNode; className?: string; palette?: readonly string[]; interactive?: boolean }

export function TubesBackground({ children, className = '', palette = GOA_PALETTE, interactive = true }: TubesBackgroundProps) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [canvasVersion, setCanvasVersion] = useState(0);
  const paletteKey = palette.filter(color => GOA_PALETTE.some(approved => approved.toLowerCase() === color.toLowerCase())).join(',');

  useEffect(() => {
    const element = host.current, surface = canvas.current;
    if (!element || !surface) return;
    if (!('IntersectionObserver' in window) || !('ResizeObserver' in window)) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarse = window.matchMedia('(pointer: coarse)');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const allowed = () => !reduced.matches && !coarse.matches && !connection?.saveData && (navigator.hardwareConcurrency || 4) >= 4;
    const colors = paletteKey ? paletteKey.split(',') : GOA_PALETTE;
    let instance: TubeScene | null = null, gone = false, failed = false, visible = false, pending = false, generation = 0;
    function fallback() { failed = true; instance?.dispose(); instance = null; if (!gone) setEnhanced(false); }
    async function start() {
      if (gone || failed || !visible || !allowed() || instance || pending) return;
      pending = true;
      const ticket = ++generation;
      try {
        const { createTubeScene } = await import('./tube-engine');
        if (gone || ticket !== generation || !allowed() || !visible) return;
        instance = createTubeScene(surface!, colors, fallback);
        if (!instance) { fallback(); return; }
        const rect = element!.getBoundingClientRect();
        instance.resize(rect.width, rect.height);
        instance.setActive(!document.hidden && visible);
        setEnhanced(true);
      } catch { if (!gone && ticket === generation) fallback(); }
      finally { if (ticket === generation) pending = false; }
    }
    function motionChanged() {
      if (!allowed()) {
        const hadContext = instance !== null;
        generation++; pending = false; instance?.dispose(); instance = null; setEnhanced(false);
        // A deliberately lost WebGL context must not be reused if motion is
        // enabled again: mount a fresh canvas, with a fresh lifecycle scope.
        if (hadContext) setCanvasVersion(value => value + 1);
      } else { void start(); }
    }
    function move(event: PointerEvent) {
      if (!interactive || !instance || event.pointerType === 'touch') return;
      const rect = element!.getBoundingClientRect();
      instance.point((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    }
    function leave() { instance?.release(); }
    function click(event: MouseEvent) {
      if (!interactive || (event.target instanceof Element && event.target.closest('a,button,input,select,textarea,label,[role="button"]'))) return;
      instance?.cycle();
    }
    function visibility() { instance?.setActive(visible && !document.hidden); }
    function lost(event: Event) { event.preventDefault(); fallback(); }
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      instance?.setActive(visible && !document.hidden);
      if (visible) void start();
    }, { threshold: 0.01 });
    const resize = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect;
      if (size) instance?.resize(size.width, size.height);
    });
    intersection.observe(element); resize.observe(element);
    element.addEventListener('pointermove', move, { passive: true });
    element.addEventListener('pointerleave', leave);
    element.addEventListener('click', click);
    surface.addEventListener('webglcontextlost', lost);
    document.addEventListener('visibilitychange', visibility);
    reduced.addEventListener('change', motionChanged); coarse.addEventListener('change', motionChanged);
    return () => {
      gone = true; generation++;
      intersection.disconnect(); resize.disconnect();
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', leave); element.removeEventListener('click', click);
      surface.removeEventListener('webglcontextlost', lost); document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', motionChanged); coarse.removeEventListener('change', motionChanged);
      instance?.dispose(); instance = null;
    };
  }, [interactive, paletteKey, canvasVersion]);

  return <div ref={host} className={`${styles.backdrop} ${className}`} data-tubes={enhanced ? 'webgl' : 'static'}>
    <svg className={`${styles.staticArt} ${enhanced ? styles.subdued : ''}`} viewBox="0 0 700 700" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
      <path d="M490-70C340 55 800 155 565 300S300 460 595 770" stroke="#91AAA0" strokeWidth="48" />
      <path d="M620-80C390 90 820 225 620 355S390 490 710 750" stroke="#E8D9B4" strokeWidth="24" />
      <path d="M710-30C420 150 840 280 630 430S530 590 710 760" stroke="#DE6C4E" strokeWidth="12" />
    </svg>
    <canvas key={`${paletteKey}:${interactive}:${canvasVersion}`} ref={canvas} className={`${styles.canvas} ${enhanced ? styles.ready : ''}`} aria-hidden="true" tabIndex={-1} />
    <div className={styles.veil} aria-hidden="true" />
    <div className={styles.foreground}>{children}</div>
  </div>;
}
