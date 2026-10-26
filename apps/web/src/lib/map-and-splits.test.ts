import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activityPoints,mergeMapPoints,placePoints,hasCoordinates,directionsUrl} from './map-points';
import {equalSplitPreview} from './split-preview';
import type {Activity,Place} from './client';
test('map projection keeps filtered place set and original itinerary numbering, excluding text-only stops',()=>{
  const places=[{id:'a',title:'Beach A',area:'North',latitude:15.5,longitude:73.8},{id:'b',title:'Beach B',area:'South',latitude:15.1,longitude:74}] as Place[];
  assert.deepEqual(placePoints(places.slice(1)).map(point=>point.id),['b']);
  const activities=[{...places[0],location:'Entrance A',startTime:'09:00'},{id:'text',title:'Breakfast without coordinates',latitude:null,longitude:null},{...places[1],location:'Entrance B'}] as Activity[];
  const points=activityPoints(activities);assert.deepEqual(points.map(point=>point.number),[1,3]);assert.deepEqual(points.map(point=>point.id),['a','b']);
  assert.equal(hasCoordinates({latitude:NaN,longitude:74}),false);assert.equal(hasCoordinates({latitude:15,longitude:181}),false);assert.equal(hasCoordinates({latitude:0,longitude:0}),true);
  assert.equal(directionsUrl(points[0]),'https://www.google.com/maps/search/?api=1&query=15.5%2C73.8');
  const merged=mergeMapPoints(points,placePoints(places));assert.equal(merged.length,2);assert.deepEqual(merged.map(point=>point.number),[1,3]);
  const additional=mergeMapPoints(points,placePoints([{...places[0],id:'new-result'}]));assert.equal(additional[2].label,'S1');assert.equal(additional[0].number,1);
});
test('draft equal-split preview includes selected people only and conserves paise',()=>{
  const shares=equalSplitPreview(400000,['d','b','a','c']);assert.equal(shares.length,4);assert.deepEqual(shares.map(share=>share.amountPaise),[100000,100000,100000,100000]);
  assert.deepEqual(equalSplitPreview(1,['c','b','a']).map(share=>share.amountPaise),[1,0,0]);assert.deepEqual(equalSplitPreview(100,[]),[]);assert.deepEqual(equalSplitPreview(100,['a','a']),[]);
});
