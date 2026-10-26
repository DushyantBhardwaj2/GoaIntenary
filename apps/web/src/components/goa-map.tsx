"use client";
import {useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import {Bookmark,ExternalLink,MapPin,Plus,RefreshCw,Search,X} from 'lucide-react';
import type {SearchPlace,Trip} from '@/lib/client';
import {directionsUrl,mergeMapPoints,placePoints,type MapPoint} from '@/lib/map-points';
import {usePlaceSearch,type PlaceSearchState} from '@/lib/use-place-search';
import {PlacePlanDialog} from './place-plan-dialog';
import {Busy} from './ui';
import styles from './map.module.css';

type Scene={L:typeof import('leaflet');map:import('leaflet').Map;layer:import('leaflet').LayerGroup;markers:Map<string,import('leaflet').Marker>};
export function GoaMap({points,title,actionLabel,onChoose,search,trip,defaultDay,onPlaceAdded}:{points:MapPoint[];title:string;actionLabel:string;onChoose:(id:string)=>void;search?:PlaceSearchState;trip?:Trip;defaultDay?:string|null;onPlaceAdded?:()=>Promise<void>|void}) {
  const container=useRef<HTMLDivElement>(null),scene=useRef<Scene|null>(null),selectionId=useRef<string|null>(null);
  const ownSearch=usePlaceSearch({enabled:!search});const lookup=search??ownSearch;
  const [chosen,setChosen]=useState<string|null>(null),[status,setStatus]=useState<'loading'|'ready'|'failed'>('loading'),[tilesFailed,setTilesFailed]=useState(false),[attempt,setAttempt]=useState(0),[revision,setRevision]=useState(0),[focusRevision,setFocusRevision]=useState(0),[showSuggestions,setShowSuggestions]=useState(true),[active,setActive]=useState(-1),[action,setAction]=useState<{place:SearchPlace;mode:'add'|'save'}|null>(null);
  const resultsId=useId(),results=lookup.data?.places;
  const searchPins=useMemo(()=>lookup.query.trim().length>=3?placePoints(results??[]):[],[lookup.query,results]);
  const allPoints=useMemo(()=>mergeMapPoints(points,searchPins),[points,searchPins]);
  const selected=allPoints.find(point=>point.id===chosen),place=results?.find(item=>item.id===chosen);
  const suggestions=lookup.query.trim().length>=3&&!lookup.loading?(results??[]).slice(0,8):[];
  const expanded=showSuggestions&&suggestions.length>0;
  const select=useCallback((id:string)=>{selectionId.current=id;setChosen(id);setFocusRevision(value=>value+1);setShowSuggestions(false);setActive(-1);},[]);
  useEffect(()=>{setActive(-1);},[results]);
  // The map lifetime is independent from queries, results and selection.
  useEffect(()=>{
    const element=container.current;if(!element)return;
    let gone=false,map:import('leaflet').Map|undefined,resize:ResizeObserver|undefined;
    setStatus('loading');setTilesFailed(false);
    async function start(){
      try{
        const L=await import('leaflet');if(gone)return;
        map=L.map(element!,{scrollWheelZoom:false,zoomControl:true,attributionControl:true}).setView([15.4,73.94],10);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',maxZoom:18,updateWhenIdle:true,keepBuffer:1,referrerPolicy:'origin'}).addTo(map).on('tileerror',()=>{if(!gone)setTilesFailed(true);});
        scene.current={L,map,layer:L.layerGroup().addTo(map),markers:new Map()};
        if(typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(()=>map?.invalidateSize({animate:false}));resize.observe(element!);}
        setStatus('ready');setRevision(value=>value+1);
      }catch{if(!gone)setStatus('failed');map?.remove();map=undefined;scene.current=null;}
    }
    void start();
    return()=>{gone=true;resize?.disconnect();scene.current=null;map?.remove();};
  },[attempt]);
  useEffect(()=>{
    const current=scene.current;if(!current)return;
    const {L,map,layer,markers}=current;layer.clearLayers();markers.clear();
    for(const point of allPoints){
      const pin=document.createElement('span');pin.className=styles.pin;pin.textContent=point.label??String(point.number);
      const tooltip=document.createElement('span');tooltip.textContent=point.title;
      const marker=L.marker([point.latitude,point.longitude],{icon:L.divIcon({html:pin,className:styles.pinHost,iconSize:[34,42],iconAnchor:[17,40]}),title:point.title,alt:point.title,keyboard:true}).addTo(layer);
      marker.bindTooltip(tooltip,{direction:'top'}).on('click',()=>select(point.id));markers.set(point.id,marker);
    }
    if(allPoints.length&&!markers.has(selectionId.current??''))map.fitBounds(L.latLngBounds(allPoints.map(point=>[point.latitude,point.longitude] as [number,number])),{padding:[36,36],maxZoom:13,animate:false});
  },[allPoints,revision,select]);
  useEffect(()=>{
    const current=scene.current;if(!current)return;
    for(const [id,marker] of current.markers){marker.getElement()?.classList.toggle(styles.selectedMarker,id===chosen);marker.setZIndexOffset(id===chosen?1000:0);}
    if(selected){current.map.setView([selected.latitude,selected.longitude],14,{animate:!window.matchMedia('(prefers-reduced-motion: reduce)').matches});current.markers.get(selected.id)?.openTooltip();}
  },[chosen,selected?.id,selected?.latitude,selected?.longitude,focusRevision,revision,allPoints]);
  return <section className={styles.panel} aria-label={title}>
    <div className={styles.heading}><div><MapPin size={17}/><strong>{title}</strong><span>{allPoints.length} {allPoints.length===1?'pin':'pins'}</span></div><button type="button" className={`text-button ${styles.resetButton}`} onClick={()=>{selectionId.current=null;setChosen(null);setAttempt(value=>value+1);}}><RefreshCw size={14}/>Reset map</button></div>
    <div className={styles.searchArea}>
      <label className={styles.searchLabel} htmlFor={`${resultsId}-input`}>Find your next stop</label>
      <form className={styles.searchForm} role="search" aria-label="Find a Goa place on the map" onSubmit={event=>{event.preventDefault();if(suggestions.length)select(suggestions[Math.min(suggestions.length-1,Math.max(0,active))]!.id);else{lookup.retry();setShowSuggestions(true);}}}>
        <div className={styles.searchInput}><Search size={19} aria-hidden="true"/><input id={`${resultsId}-input`} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={resultsId} aria-activedescendant={expanded&&active>=0?`${resultsId}-${active}`:undefined} maxLength={80} value={lookup.query} placeholder="Try Palolem Beach, Panaji, or a café…" onFocus={()=>setShowSuggestions(true)} onChange={event=>{lookup.setQuery(event.target.value);setShowSuggestions(true);setActive(-1);}} onKeyDown={event=>{if(event.key==='Escape'){setShowSuggestions(false);setActive(-1);}else if((event.key==='ArrowDown'||event.key==='ArrowUp')&&suggestions.length){event.preventDefault();setShowSuggestions(true);setActive(index=>event.key==='ArrowDown'?(index+1)%suggestions.length:(index<=0?suggestions.length-1:index-1));}}}/>{lookup.query&&<button className={styles.clearButton} type="button" aria-label="Clear map search" onClick={()=>{lookup.setQuery('');selectionId.current=null;setChosen(null);setActive(-1);}}><X size={17}/></button>}</div><button className={`button primary ${styles.searchButton}`} type="submit" disabled={lookup.query.trim().length<3}>Search<Search size={16} aria-hidden="true"/></button>
      </form>
      {lookup.loading&&<p className={styles.searchStatus} role="status"><Busy text="Finding places in Goa…"/></p>}
      {lookup.error&&<p className={styles.notice} role="alert">{lookup.error} <button type="button" className="text-button" onClick={lookup.retry}>Retry search</button></p>}
      {expanded&&<ul className={styles.results} id={resultsId} role="listbox" aria-label="Matching Goa places">{suggestions.map((item,index)=><li key={item.id} role="presentation"><button id={`${resultsId}-${index}`} type="button" role="option" aria-selected={chosen===item.id} className={active===index?styles.activeResult:''} onClick={()=>select(item.id)}><MapPin size={17}/><span><strong>{item.title}</strong><small>{item.area} · {item.category} · {item.origin==='openstreetmap'?'OpenStreetMap':'Reviewed place'}</small></span><span>Show on map</span></button></li>)}</ul>}
      {!lookup.loading&&!lookup.error&&lookup.query.trim().length>=3&&results?.length===0&&<p className={styles.searchStatus} role="status">{lookup.data?.providerAvailable&&lookup.data.providerNotice?.includes("very broad area")?lookup.data.providerNotice:"No matching Goa places. Try a beach, fort, station, market, or town."}</p>}
      <div className={styles.searchMeta}><p className={styles.searchHint}>{lookup.data?.providerAvailable===false?'Wider search is unavailable. Showing reviewed matches.':'Choose a result to see its pin and add it to your day.'}</p>{lookup.data?.providerNotice&&<details className={styles.sourceInfo}><summary>About these places</summary><p>{lookup.data.providerNotice} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">Photon search</a></p></details>}</div>
    </div>
    <div className={styles.mapWrap}><div className={styles.surface} ref={container} role="region" aria-label={`${title}. Use plus and minus to zoom; search results and the list provide all planning actions.`}/>{status==='loading'&&<div className={styles.loading}><Busy text="Opening the coast…"/></div>}</div>
    {status==='failed'&&<p className={styles.notice} role="status">The map could not load. Search results and list actions are still available.</p>}
    {tilesFailed&&<p className={styles.notice} role="status">Some map tiles are unavailable. Search, pins and list actions remain available; reset the map to retry.</p>}
    {selected&&<div className={styles.selection} aria-live="polite"><div><strong>{selected.title}</strong><span>{selected.subtitle}{place?` · ${place.category}`:''}</span>{place&&<p>{place.description}</p>}{place&&<a className="text-button" href={place.sourceUrl} target="_blank" rel="noreferrer">{place.origin==='openstreetmap'?'OpenStreetMap source':'Reviewed source'}<ExternalLink size={13}/></a>}</div><div>{place?<><button className="button primary" onClick={()=>setAction({place,mode:'add'})}><Plus size={16}/>Add to itinerary</button><button className="button secondary" onClick={()=>setAction({place,mode:'save'})}><Bookmark size={16}/>Save for later</button></>:<button className="button secondary" onClick={()=>onChoose(selected.id)}>{actionLabel}</button>}<a className="text-button" href={directionsUrl(selected)} target="_blank" rel="noreferrer">Open in Google Maps<ExternalLink size={14}/></a></div></div>}
    <p className={styles.caption}>Numbered pins follow the list; S pins are search results. Approximate locations do not verify entrances, routes or availability. Selecting a place never changes your plan. <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a></p>
    {action&&<PlacePlanDialog key={`${action.place.id}:${action.mode}`} place={action.place} mode={action.mode} trip={trip} defaultDay={defaultDay} onClose={()=>setAction(null)} onAdded={onPlaceAdded}/>}
  </section>;
}
