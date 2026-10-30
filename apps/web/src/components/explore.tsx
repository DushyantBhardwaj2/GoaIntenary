"use client";
import {useEffect,useMemo,useState} from 'react';
import {ArrowUpRight,Bookmark,ExternalLink,MapPin,Plus} from 'lucide-react';
import {activityCategories,type SearchPlace} from '@/lib/client';
import {usePlaceSearch} from '@/lib/use-place-search';
import {placePoints} from '@/lib/map-points';
import {Shell} from './shell';
import {DestinationArt} from './destination-art';
import {Busy,EmptyState} from './ui';
import {GoaMap} from './goa-map';
import {PlacePlanDialog} from './place-plan-dialog';

export function Explore(){
  const [category,setCategory]=useState(''),[region,setRegion]=useState('all'),[action,setAction]=useState<{place:SearchPlace;mode:'save'|'add'}|null>(null);
  const search=usePlaceSearch({category,region,catalogueWhenEmpty:true});
  const {data,loading}=search;
  useEffect(()=>{const initial=new URLSearchParams(window.location.search).get('region');if(initial&&['north','south','central','all'].includes(initial))setRegion(initial);},[]);
  const pins=useMemo(()=>placePoints(data?.places??[]),[data]);
  return <Shell>
    <section className="explore-heading"><div><span className="eyebrow">A LITTLE CURIOSITY LOOKS GOOD ON YOU</span><h1>Find your<br/><em>kind of Goa.</em></h1><p>Search the coast. Pick a place. Make it part of your day.<br/>A shared plan starts with one good idea.</p></div><div className="explore-stamp"><DestinationArt kind="culture"/><span>GO SLOW. LOOK CLOSER.</span></div></section>
    <section className="explore-catalogue">
      <div className="filter-toolbar explore-filters"><label>Region<select value={region} onChange={event=>setRegion(event.target.value)}><option value="all">All Goa</option><option value="north">North Goa</option><option value="south">South Goa</option><option value="central">Central Goa</option></select></label><label>Category<select value={category} onChange={event=>setCategory(event.target.value)}><option value="">Every kind of day</option>{activityCategories.map(value=><option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</select></label></div>
      <GoaMap points={pins} title="Search Goa on the map" actionLabel="Plan this place" onChoose={id=>{const place=data?.places.find(item=>item.id===id);if(place)setAction({place,mode:'add'});}} search={search}/>
      <div className="catalogue-result-heading"><span>{loading?'Finding a few good places…':data?`${data.total} ${data.total===1?'place':'places'} to get curious about`:'Place search unavailable'}</span><span><MapPin size={13}/>Select a pin or use these cards</span></div>
      {data?.catalogue&&<div className="catalogue-notice"><Bookmark size={17}/><p>{data.catalogue.notice}</p></div>}
      {loading&&!data?<div className="inline-loading"><Busy text="Taking a look around…"/></div>:data?.places.length?<div className="place-grid" aria-busy={loading}>{data.places.map(place=><article className={`place-card ${place.region}`} key={place.id}><DestinationArt kind={place.category}/><div className="place-card-content"><span className="eyebrow">{place.region.toUpperCase()} GOA / {place.category}</span><h3>{place.title}</h3><p className="place-area"><MapPin size={14}/>{place.area}</p><p>{place.description}</p><div className="place-source"><a href={place.sourceUrl} target="_blank" rel="noreferrer" className="source-link"><ExternalLink size={13}/>{place.origin==='openstreetmap'?'OpenStreetMap source':'Reviewed source'}</a><span>{place.origin==='openstreetmap'?'Retrieved':'Reviewed'} {place.checkedAt.slice(0,10)}</span></div><div className="saved-card-actions"><button className="button primary" onClick={()=>setAction({place,mode:'add'})}><Plus size={16}/>Add to itinerary<ArrowUpRight size={16}/></button><button className="button secondary" onClick={()=>setAction({place,mode:'save'})}><Bookmark size={16}/>Save for later</button></div></div></article>)}</div>:data&&<EmptyState title="A different kind of detour."><p>{data.providerAvailable===false?'Wider search is unavailable and no reviewed places match. Retry the map search or broaden these filters.':'No Goa places match these filters. Try another spelling or a broader search.'}</p><button className="button secondary" onClick={()=>{search.setQuery('');setCategory('');setRegion('all');}}>Clear the filters</button></EmptyState>}
    </section>
    {action&&<PlacePlanDialog key={`${action.place.id}:${action.mode}`} place={action.place} mode={action.mode} onClose={()=>setAction(null)}/>}
  </Shell>;
}
