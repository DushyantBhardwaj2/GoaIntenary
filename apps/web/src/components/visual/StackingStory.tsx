"use client";

import { useEffect, useRef, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Compass, HeartHandshake, MapPin, Wallet } from 'lucide-react';
import styles from './effects.module.css';

const chapters = [
  { number: '01', kicker: 'GIVE THE GROUP CHAT A DESTINATION', title: 'First, put Goa on the calendar.', text: 'Pick the dates, a corner of the coast, and a budget that feels like you. One private place for the whole getaway.', link: '/trips', action: 'Start a trip', icon: CalendarDays, note: 'THE PLAN BEGINS WITH YOU', color: 'sand' },
  { number: '02', kicker: 'THE BEST PART IS WHO COMES ALONG', title: 'Make room for your people.', text: 'Send a private invitation and approve who joins. Everyone in your circle can help shape the days ahead.', link: '/trips', action: 'Bring your friends', icon: HeartHandshake, note: 'PRIVATE BY NATURE', color: 'green' },
  { number: '03', kicker: 'FOLLOW A LITTLE CURIOSITY', title: 'Find your kind of Goa.', text: 'Browse a small, sourced collection of beaches, viewpoints and heritage places. Save the ones you love for your own trip.', link: '/explore', action: 'Explore Goa', icon: Compass, note: 'SOURCED PLACES. OPEN POSSIBILITIES.', color: 'coral' },
  { number: '04', kicker: 'A LITTLE STRUCTURE. ROOM TO WANDER.', title: 'Give every day its own rhythm.', text: 'Add a sunrise, move a lunch, keep a good idea unscheduled. Your itinerary changes when you decide it should.', link: '/trips', action: 'Build your day', icon: MapPin, note: 'MANUALLY PLANNED. ENTIRELY YOURS.', color: 'ivory' },
  { number: '05', kicker: 'FEWER LOOSE ENDS, MORE GOOD DAYS', title: 'Keep the practical bits together.', text: 'Keep planned costs separate from recorded spending. Reopen the same trip, with your people and your plans right where you left them.', link: '/trips', action: 'Make it happen', icon: Wallet, note: 'SEE YOU BY THE SEA', color: 'gold' },
] as const;

export function StackingStory() {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = window.matchMedia('(min-width: 800px)');
    const cards = [...element.querySelectorAll<HTMLElement>('[data-story-card]')];
    let frame = 0, visible = false;
    function paint() {
      frame = 0;
      const nextTops = cards.map(card => card.getBoundingClientRect().top);
      cards.forEach((card, index) => {
        const next = nextTops[index + 1];
        const progress = next === undefined || motion.matches || !desktop.matches ? 0 : Math.max(0, Math.min(1, (window.innerHeight - next) / Math.max(1, window.innerHeight - 130)));
        card.style.setProperty('--story-recede', String(progress));
      });
    }
    function update() { if (visible && !frame) frame = requestAnimationFrame(paint); }
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; update(); }, { rootMargin: '150px' });
    observer.observe(element);
    window.addEventListener('scroll', update, { passive: true }); window.addEventListener('resize', update, { passive: true });
    motion.addEventListener('change', update); desktop.addEventListener('change', update);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('scroll', update); window.removeEventListener('resize', update);
      motion.removeEventListener('change', update); desktop.removeEventListener('change', update);
    };
  }, []);

  return <section ref={section} className={styles.story} aria-label="Five chapters of a Goa getaway">
    <div className={styles.storyHeading}><span>YOUR GOA, ONE GOOD IDEA AT A TIME</span><p>A getaway worth getting together for.</p></div>
    <ol className={styles.stack}>{chapters.map((chapter, index) => <li key={chapter.number} data-story-card className={`${styles.storyCard} ${styles[chapter.color]}`} style={{ '--card-index': index } as CSSProperties}>
      <div className={styles.chapterCopy}><span className={styles.chapterKicker}>{chapter.number} / {chapter.kicker}</span><h2>{chapter.title}</h2><p>{chapter.text}</p><Link href={chapter.link}>{chapter.action}<ArrowUpRight size={18} /></Link></div>
      <div className={styles.chapterArt} aria-hidden="true"><span className={styles.chapterOrbit} /><chapter.icon size={80} strokeWidth={0.85} /><span className={styles.chapterNumber}>{chapter.number}</span><small>{chapter.note}</small></div>
    </li>)}</ol>
  </section>;
}
