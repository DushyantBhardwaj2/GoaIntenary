"use client";
import { useCallback,useEffect,useState } from 'react';
import {api,type PlaceResults} from './client';
export type PlaceSearchState={query:string;setQuery:(value:string)=>void;data:PlaceResults|null;loading:boolean;error:string;retry:()=>void};
export function usePlaceSearch({enabled=true,category='',region='all',initialQuery='',catalogueWhenEmpty=false}:{enabled?:boolean;category?:string;region?:string;initialQuery?:string;catalogueWhenEmpty?:boolean}={}):PlaceSearchState {
  const [query,setQuery]=useState(initialQuery),[data,setData]=useState<PlaceResults|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const retry=useCallback(()=>setAttempt(value=>value+1),[]);
  useEffect(()=>{
    const text=query.trim();if(!enabled)return;
    if(text.length<3&&!catalogueWhenEmpty){setData(null);setError('');setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError('');
    const timer=window.setTimeout(async()=>{
      try{
        const params=new URLSearchParams();if(text)params.set('q',text);if(category)params.set('category',category);if(region!=='all')params.set('region',region);
        const results=await api<PlaceResults>(`/api/discovery/${text.length>=3?'search':'places'}?${params}`,{signal:controller.signal});
        if(!controller.signal.aborted)setData(results);
      }catch(err){if(!controller.signal.aborted){setData(null);setError(err instanceof Error?err.message:'Place search is unavailable. Try again.');}}
      finally{if(!controller.signal.aborted)setLoading(false);}
    },text.length>=3?300:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,category,region,attempt,enabled,catalogueWhenEmpty]);
  return{query,setQuery,data,loading,error,retry};
}
