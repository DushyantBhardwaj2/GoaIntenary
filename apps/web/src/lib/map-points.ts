import type { Activity, Place } from './client';
export type MapPoint = { id: string; title: string; subtitle: string; latitude: number; longitude: number; number: number; label?: string };
export function mergeMapPoints(base:MapPoint[],results:MapPoint[]):MapPoint[]{
  const merged=new Map(base.map(point=>[point.id,point]));
  for(const [index,point] of results.entries())if(!merged.has(point.id))merged.set(point.id,{...point,label:`S${index+1}`});
  return [...merged.values()];
}
export const hasCoordinates = <T extends { latitude: number | null; longitude: number | null }>(point: T): point is T & { latitude: number; longitude: number } =>
  typeof point.latitude==='number' && Number.isFinite(point.latitude) && Math.abs(point.latitude)<=90 &&
  typeof point.longitude==='number' && Number.isFinite(point.longitude) && Math.abs(point.longitude)<=180;
export function placePoints(places: Place[]): MapPoint[] {
  return places.filter(hasCoordinates).map((place,index)=>({id:place.id,title:place.title,subtitle:place.area,latitude:place.latitude,longitude:place.longitude,number:index+1}));
}
export function activityPoints(activities: Activity[]): MapPoint[] {
  // Preserve itinerary numbers even when a text-only activity has no pin.
  return activities.map((activity,index)=>({...activity,number:index+1})).filter(hasCoordinates).map(activity=>({id:activity.id,title:activity.title,subtitle:activity.location||activity.startTime||'Time is open',latitude:activity.latitude,longitude:activity.longitude,number:activity.number}));
}
export function directionsUrl(point: {latitude:number;longitude:number}): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.latitude},${point.longitude}`)}`;
}
