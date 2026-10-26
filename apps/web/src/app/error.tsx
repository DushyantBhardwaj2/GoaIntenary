"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="standalone"><span className="eyebrow">A momentary detour</span><h1>We couldn’t load this page.</h1><p>Your saved trips are kept by the trip service. Try loading this page again.</p><button className="button primary" onClick={reset}>Try again</button></main>; }
