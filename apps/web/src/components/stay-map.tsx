"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Busy } from "./ui";
import styles from "./stays.module.css";

export type StayPinSource = {
  id: string;
  propertyName: string;
  latitude: number | null;
  longitude: number | null;
};

type Scene = {
  L: typeof import("leaflet");
  map: import("leaflet").Map;
  layer: import("leaflet").LayerGroup;
};

const coast: [number, number] = [15.4, 73.94];

function mappedStays(stays: StayPinSource[]) {
  return stays.flatMap((stay) => {
    if (typeof stay.latitude !== "number" || typeof stay.longitude !== "number") return [];
    if (!Number.isFinite(stay.latitude) || !Number.isFinite(stay.longitude)) return [];
    return [{ id: stay.id, propertyName: stay.propertyName, latitude: stay.latitude, longitude: stay.longitude }];
  });
}

export function StayMap({ stays, compact = false }: { stays: StayPinSource[]; compact?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [tilesFailed, setTilesFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const pins = useMemo(() => mappedStays(stays), [stays]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const host: HTMLDivElement = element;
    let gone = false;
    let map: import("leaflet").Map | undefined;
    let resize: ResizeObserver | undefined;
    setStatus("loading");
    setTilesFailed(false);
    async function start() {
      try {
        const L = await import("leaflet");
        if (gone) return;
        map = L.map(host, { scrollWheelZoom: false, zoomControl: true, attributionControl: true }).setView(coast, 10);
        // Live OpenStreetMap tiles only. Do not prefetch or cache an offline pack.
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
          maxZoom: 18,
          updateWhenIdle: true,
          keepBuffer: 1,
          referrerPolicy: "origin",
        }).addTo(map).on("tileerror", () => { if (!gone) setTilesFailed(true); });
        scene.current = { L, map, layer: L.layerGroup().addTo(map) };
        if (typeof ResizeObserver !== "undefined") {
          resize = new ResizeObserver(() => map?.invalidateSize({ animate: false }));
          resize.observe(host);
        }
        setStatus("ready");
        setRevision((value) => value + 1);
      } catch {
        if (!gone) setStatus("failed");
        map?.remove();
        map = undefined;
        scene.current = null;
      }
    }
    void start();
    return () => {
      gone = true;
      resize?.disconnect();
      scene.current = null;
      map?.remove();
    };
  }, [attempt]);

  useEffect(() => {
    const current = scene.current;
    if (!current || status !== "ready") return;
    const { L, map, layer } = current;
    layer.clearLayers();
    for (const stay of pins) {
      const pin = document.createElement("span");
      pin.className = styles.pin;
      pin.textContent = stay.propertyName.trim().charAt(0).toUpperCase() || "S";
      const marker = L.marker([stay.latitude, stay.longitude], {
        icon: L.divIcon({ html: pin, className: styles.pinHost, iconSize: [34, 42], iconAnchor: [17, 40] }),
        title: stay.propertyName,
        alt: stay.propertyName,
        keyboard: true,
      }).addTo(layer);
      marker.bindTooltip(stay.propertyName, { direction: "top" });
    }
    map.invalidateSize({ animate: false });
    if (pins.length) map.fitBounds(L.latLngBounds(pins.map((stay) => [stay.latitude, stay.longitude] as [number, number])), { padding: [36, 36], maxZoom: 13, animate: false });
    else map.setView(coast, 10, { animate: false });
  }, [pins, revision, status]);

  const retry = () => setAttempt((value) => value + 1);
  return <div className={compact ? `${styles.mapBlock} ${styles.compact}` : styles.mapBlock}>
    <div className={styles.mapWrap}>
      <div ref={container} className={styles.mapSurface} role="region" aria-label="Stay map. A pin appears only when that stay has both latitude and longitude. Stays without a pin remain in the list." />
      {status === "loading" && <div className={styles.mapLoading}><Busy text="Opening the stay map…" /></div>}
    </div>
    {status === "failed" && <p className={styles.mapError} role="alert">The stay map could not load. The stay list is still available. <button type="button" className="button secondary" onClick={retry}>Retry map</button></p>}
    {status === "ready" && tilesFailed && <p className={styles.mapError} role="status">Some map tiles did not load. The stay list is still available. <button type="button" className="button secondary" onClick={retry}>Retry map</button></p>}
    <p className={styles.mapCaption}>{pins.length === 0 ? "No stay has both coordinates, so this map has no pin." : `${pins.length} ${pins.length === 1 ? "stay is" : "stays are"} on the map.`} Stays without coordinates stay in the list. <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></p>
  </div>;
}
