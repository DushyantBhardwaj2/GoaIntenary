"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { createPlannerData, type PlannerData } from "@/lib/planner-data";
import { useSession } from "./session";

const Context = createContext<PlannerData | null>(null);

export function PlannerDataProvider({ tripId, children }: { tripId: string; children: ReactNode }) {
  const { user } = useSession();
  const data = useMemo(() => createPlannerData(tripId), [tripId, user?.id]);
  useEffect(() => {
    const changed = (event: Event) => data.invalidate((event as CustomEvent<{ path: string }>).detail.path);
    const denied = () => data.invalidate();
    window.addEventListener("goa-data-changed", changed);
    window.addEventListener("goa-access-denied", denied);
    return () => {
      data.invalidate();
      window.removeEventListener("goa-data-changed", changed);
      window.removeEventListener("goa-access-denied", denied);
    };
  }, [data]);
  return <Context.Provider value={data}>{children}</Context.Provider>;
}

export function usePlannerData() { return useContext(Context); }
