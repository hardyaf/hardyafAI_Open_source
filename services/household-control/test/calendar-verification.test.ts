import test from "node:test";
import assert from "node:assert/strict";
import {matchesCalendarEvent} from "../src/domains/google/event-verification.ts";
import {GoogleDomain} from "../src/domains/google/index.ts";
import type {NativeDomainContext,NativeJson,NativeJsonRunner} from "../src/domains/native-contracts.ts";
const input={summary:"Soccer",start:"2026-11-08T10:00:00-05:00",end:"2026-11-08T11:00:00-05:00",timeZone:"America/New_York",reminders:["popup:1h","email:1d"]};
function event():NativeJson{return {id:"event-one",summary:input.summary,start:{dateTime:"2026-11-08T15:00:00Z",timeZone:input.timeZone},end:{dateTime:"2026-11-08T16:00:00Z",timeZone:input.timeZone},reminders:{useDefault:false,overrides:[{method:"email",minutes:1440},{method:"popup",minutes:60}]}};}
test("calendar readback normalizes reminder units and ordering, and zone aliases",()=>{
  assert.equal(matchesCalendarEvent(event(),input),true);
  assert.equal(matchesCalendarEvent(event(),{...input,timeZone:"US/Eastern",reminders:["email:1440m","popup:60m"]}),true);
});
test("calendar readback rejects missing, default, different or malformed reminders",()=>{
  for(const reminders of [undefined,{useDefault:true},{useDefault:false,overrides:[]},{useDefault:false,overrides:[{method:"popup",minutes:30}]},{useDefault:false,overrides:[{method:"popup",minutes:"60"}]}])
    assert.equal(matchesCalendarEvent({...event(),reminders},input),false);
  assert.equal(matchesCalendarEvent({...event(),reminders:{useDefault:false}},{...input,reminders:[]}),true);
});
test("equivalent instants do not verify a missing or different stored time zone",()=>{
  for(const zone of [undefined,"UTC","America/Chicago"]){const value=event();value.start={dateTime:"2026-11-08T15:00:00Z",...(zone?{timeZone:zone}:{})};assert.equal(matchesCalendarEvent(value,input),false);}
  assert.equal(matchesCalendarEvent({start:{date:"2026-11-08"},end:{date:"2026-11-09"}},{start:"2026-11-08",end:"2026-11-09",allDay:true}),true);
});
test("the provider create path verifies the effective configured zone and requested reminders",async()=>{
  const context:NativeDomainContext={profileId:"adult",agentId:"main",sessionKey:"session",conversationId:"conversation",audience:"private",allowedScopes:["household"],authorizedAttendees:[],assertCurrent(){}};
  for(const broken of [false,true]){
    const runner:NativeJsonRunner={async runJson(_binary,args){if(args.includes("events"))return {events:[]};if(args.includes("create"))return {event:{id:"event-one"}};return {event:broken?{...event(),reminders:{useDefault:true}}:event()};}};
    const domain=new GoogleDomain({gogBinary:"/trusted/gog",account:"bot@example.test",client:"house",calendarId:"house@example.test",timeZone:"America/New_York"},runner);
    const {timeZone,...requested}=input;
    const result=await domain.execute("household_calendar_create",{...requested,operationId:"calendar-verification-test"},context) as {verified:boolean};
    assert.equal(result.verified,!broken);
  }
});


test("explicitly empty reminders disables provider defaults on create and update",async()=>{
  const context:NativeDomainContext={profileId:"adult",agentId:"main",sessionKey:"session",conversationId:"conversation",audience:"private",allowedScopes:["household"],authorizedAttendees:[],assertCurrent(){}};
  for(const action of ["create","update"]){
    const calls:string[][]=[];
    const runner:NativeJsonRunner={async runJson(_binary,args){calls.push([...args]);if(args.includes("events"))return {events:[]};return {event:{...event(),reminders:{useDefault:false}}};}};
    const domain=new GoogleDomain({gogBinary:"/trusted/gog",account:"bot@example.test",client:"house",calendarId:"house@example.test",timeZone:"America/New_York"},runner);
    const result=await domain.execute("household_calendar_"+action,{...input,reminders:[],operationId:"calendar-no-reminders",...(action==="update"?{eventId:"event-one",scope:"all"}:{})},context) as {verified:boolean};
    assert.equal(result.verified,true);assert.ok(calls.some(args=>args.includes(action)&&args.includes("--no-reminders")));
  }
});


test("timezone-only edits send the zone and cannot verify an unchanged provider zone",async()=>{
  const context:NativeDomainContext={profileId:"adult",agentId:"main",sessionKey:"session",conversationId:"conversation",audience:"private",allowedScopes:["household"],authorizedAttendees:[],assertCurrent(){}};
  const calls:string[][]=[];
  const runner:NativeJsonRunner={async runJson(_binary,args){calls.push([...args]);return {event:event()};}};
  const domain=new GoogleDomain({gogBinary:"/trusted/gog",account:"bot@example.test",client:"house",calendarId:"house@example.test",timeZone:"America/New_York"},runner);
  const result=await domain.execute("household_calendar_update",{eventId:"event-one",scope:"all",timeZone:"America/Chicago",operationId:"calendar-zone-only"},context) as {verified:boolean};
  assert.equal(result.verified,false);assert.ok(calls.some(args=>args.includes("update")&&args.includes("--timezone=America/Chicago")));
  assert.equal(matchesCalendarEvent(event(),{timeZone:"America/New_York"}),true);
  await assert.rejects(()=>domain.execute("household_calendar_update",{eventId:"event-one",scope:"all",allDay:true,operationId:"calendar-type-only"},context),{code:"all_day_change_requires_interval"});
});
