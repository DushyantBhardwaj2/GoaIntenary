"use client";
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,Bookmark,Check,Plus} from 'lucide-react';
import {api,core,type SearchPlace,type Trip} from '@/lib/client';
import {useSession} from './session';
import {ActivityForm} from './activity-form';
import {Busy,Dialog,Notice} from './ui';

export function PlacePlanDialog({place,mode,trip,defaultDay,onClose,onAdded}:{place:SearchPlace;mode:'add'|'save';trip?:Trip;defaultDay?:string|null;onClose:()=>void;onAdded?:()=>Promise<void>|void}) {
  const {user}=useSession();
  const completed=useRef(false);const [added,setAdded]=useState(false);
  const [trips,setTrips]=useState<Trip[]>(trip?[trip]:[]),[tripId,setTripId]=useState(trip?.id??''),[loading,setLoading]=useState(!trip),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[planning,setPlanning]=useState(mode==='add'&&Boolean(trip));
  const load=useCallback(async()=>{
    if(trip||!user)return;
    setLoading(true);setError('');
    try{const result=await api<{trips:Trip[]}>(`${core}/trips`);setTrips(result.trips);setTripId(current=>result.trips.some(item=>item.id===current)?current:result.trips[0]?.id??'');}
    catch(err){setError(err instanceof Error?err.message:'Unable to load your trips.');}finally{setLoading(false);}
  },[trip,user]);
  useEffect(()=>{void load();},[load]);
  const chosen=trips.find(item=>item.id===tripId);
  if(!user)return <Dialog title="Make room for this place." onClose={onClose}><p>Sign in to add {place.title} to a private trip. Searching and selecting a pin never changes an itinerary.</p><div className="dialog-actions"><button className="button secondary" onClick={onClose}>Keep exploring</button><Link className="button primary" href="/auth?next=%2Fexplore">Sign in to plan<ArrowRight size={16}/></Link></div></Dialog>;
  if(added&&chosen)return <Dialog title="A good place in your plan." onClose={onClose}><Notice tone="success"><Check size={16}/>{place.title} was added to {chosen.name}.</Notice><p>Your chosen day, coordinates and source note are saved. You can change the details in the itinerary.</p><div className="dialog-actions"><button className="button secondary" onClick={onClose}>Keep exploring</button><Link className="button primary" href={`/trips/${chosen.id}`}>Open itinerary<ArrowRight size={16}/></Link></div></Dialog>;
  if(planning&&chosen)return <ActivityForm trip={chosen} place={{placeId:place.id,title:place.title,category:place.category,latitude:place.latitude,longitude:place.longitude,area:place.area,sourceUrl:place.sourceUrl}} defaultDay={defaultDay===undefined?chosen.startDate:defaultDay} onClose={()=>{if(completed.current){setPlanning(false);setAdded(true);}else onClose();}} onSaved={async()=>{await onAdded?.();completed.current=true;}}/>;
  async function save(){setBusy(true);setError('');try{await api(`${core}/trips/${tripId}/saved-places`,{method:'POST',body:JSON.stringify({placeId:place.id,title:place.title,category:place.category,region:place.region,latitude:place.latitude,longitude:place.longitude,sourceUrl:place.sourceUrl})});setSaved(true);await onAdded?.();}catch(err){setError(err instanceof Error?err.message:'Unable to save the place.');}finally{setBusy(false);}}
  return <Dialog title={saved?'A good idea, kept.':mode==='add'?'Which trip is this for?':'Keep this place for later.'} busy={busy} onClose={onClose}>
    {saved?<><Notice tone="success"><Check size={16}/>{place.title} is saved. It has not been scheduled.</Notice><div className="dialog-actions"><button className="button secondary" onClick={onClose}>Keep exploring</button><Link className="button primary" href={`/trips/${tripId}?tab=saved`}>Open saved places<ArrowRight size={16}/></Link></div></>:loading?<Busy text="Finding your trips…"/>:<><p><strong>{place.title}</strong>{mode==='add'?' · Next, choose a day, time and details before saving.':' · Saving keeps an idea without booking or scheduling it.'}</p>{error&&<Notice>{error}<button className="text-button" onClick={()=>void load()}>Reload trips</button></Notice>}{trips.length?<form className="premium-form" onSubmit={event=>{event.preventDefault();if(mode==='add')setPlanning(true);else void save();}}><label>Choose a trip<select required value={tripId} onChange={event=>setTripId(event.target.value)}>{trips.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy||!chosen}>{busy?<Busy/>:mode==='add'?<><Plus size={16}/>Choose day & details</>:<><Bookmark size={16}/>Save for later</>}</button></div></form>:!error&&<><p>Create a trip first, then choose the places that suit your people.</p><Link className="button primary" href="/trips">Create a trip<ArrowRight size={16}/></Link></>}</>}
  </Dialog>;
}
