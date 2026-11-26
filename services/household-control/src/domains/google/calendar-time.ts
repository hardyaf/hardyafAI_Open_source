import { NativeDomainError } from "../native-contracts.ts";
import { text, timezone, rfc3339Instant } from "../native-validation.ts";
export {rfc3339Instant} from "../native-validation.ts";

function localParts(epoch:number,zone:string):string {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(epoch);
  const get=(key:string)=>parts.find(part=>part.type===key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}
function localTime(value:unknown):string {
  const local=text(value,19);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local))throw new NativeDomainError("invalid_local_datetime");
  const epoch=Date.parse(local+"Z");
  if(!Number.isFinite(epoch)||new Date(epoch).toISOString().slice(0,19)!==local)throw new NativeDomainError("invalid_local_datetime");
  return local;
}

/** Return every actual instant for a wall time; DST gaps/overlaps never guess. */
export function resolveCalendarTime(value:unknown,zoneValue:unknown) {
  const local=localTime(value),zone=timezone(zoneValue),wall=Date.parse(local+"Z");
  const offsets=new Set<number>();
  for(let step=-48;step<=48;step++) {
    const epoch=wall+step*3_600_000;
    offsets.add(Date.parse(localParts(epoch,zone)+"Z")-epoch);
  }
  const candidates=[...offsets].map(offset=>({offset,epoch:wall-offset})).filter(item=>localParts(item.epoch,zone)===local).sort((a,b)=>a.epoch-b.epoch).map(item=>{
    const minutes=Math.abs(item.offset/60_000);
    const suffix=(item.offset>=0?"+":"-")+String(Math.floor(minutes/60)).padStart(2,"0")+":"+String(minutes%60).padStart(2,"0");
    return {dateTime:local+suffix,utc:new Date(item.epoch).toISOString(),timeZone:zone};
  });
  return {local,timeZone:zone,status:candidates.length===1?"unique":candidates.length===0?"nonexistent":"ambiguous",candidates};
}

export function calendarInstant(value:unknown,zone:string):string {
  const input=rfc3339Instant(value);
  const epoch=Date.parse(input);
  if(!Number.isFinite(epoch)||localParts(epoch,zone)!==input.slice(0,19))throw new NativeDomainError("datetime_timezone_mismatch");
  const secondEpoch=epoch-((epoch%1000+1000)%1000);
  if(!resolveCalendarTime(input.slice(0,19),zone).candidates.some(candidate=>Date.parse(candidate.dateTime)===secondEpoch))throw new NativeDomainError("datetime_timezone_mismatch");
  return input;
}
