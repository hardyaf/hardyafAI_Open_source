import type {NativeJson} from "../native-contracts.ts";
import {record} from "../native-validation.ts";

function sourceDate(event:NativeJson,key:"start"|"end"):string|null{
  const value=event[key];if(!value||typeof value!=="object")return null;
  const source=record(value);return typeof source.dateTime==="string"?source.dateTime:typeof source.date==="string"?source.date:null;
}
function canonicalZone(value:unknown):string|null{
  if(typeof value!=="string")return null;
  try{return new Intl.DateTimeFormat("en",{timeZone:value}).resolvedOptions().timeZone;}catch{return null;}
}
function requestedReminders(value:unknown):string[]|null{
  if(!Array.isArray(value))return null;
  const units:Record<string,number>={m:1,h:60,d:1440,w:10080},result:string[]=[];
  for(const item of value){
    if(typeof item!=="string")return null;
    const match=item.match(/^(popup|email):(\d+)(m|h|d|w)$/);if(!match)return null;
    const minutes=Number(match[2])*units[match[3]];if(!Number.isSafeInteger(minutes))return null;
    result.push(match[1]+":"+minutes);
  }
  return [...new Set(result)].sort();
}
function actualReminders(value:unknown):string[]|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const reminders=record(value);
  // Calendar defaults are not proof of the explicit requested overrides.
  if(reminders.useDefault!==false)return null;
  const overrides=reminders.overrides??[];if(!Array.isArray(overrides))return null;
  const result:string[]=[];
  for(const raw of overrides){
    if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
    const item=record(raw);
    if(!["popup","email"].includes(String(item.method))||!Number.isSafeInteger(item.minutes)||Number(item.minutes)<0)return null;
    result.push(String(item.method)+":"+String(item.minutes));
  }
  return [...new Set(result)].sort();
}
/** Compare requested intent with provider readback, never the mutation echo.
 * Offset-equivalent timestamps do not prove a recurrence's time-zone intent. */
export function matchesCalendarEvent(event:NativeJson,input:NativeJson):boolean{
  if(input.summary!==undefined&&event.summary!==input.summary)return false;
  if(input.timeZone!==undefined&&input.allDay!==true)for(const key of ["start","end"]){
    const raw=event[key];if(!raw||typeof raw!=="object"||Array.isArray(raw))return false;
    const endpoint=record(raw),expected=canonicalZone(input.timeZone);
    if(expected===null||canonicalZone(endpoint.timeZone)!==expected)return false;
  }

  for(const key of ["start","end"] as const)if(input[key]!==undefined){
    const actual=sourceDate(event,key);if(!actual)return false;
    const endpoint=record(event[key]);
    if(input.allDay===true){if(endpoint.date!==input[key]||endpoint.dateTime!==undefined)return false;}
    else{
      if(typeof endpoint.dateTime!=="string"||Date.parse(actual)!==Date.parse(String(input[key])))return false;
      if(input.timeZone!==undefined&&(canonicalZone(endpoint.timeZone)===null||canonicalZone(endpoint.timeZone)!==canonicalZone(input.timeZone)))return false;
    }
  }
  for(const key of ["description","location","visibility","transparency"])if(input[key]!==undefined&&(event[key]??"")!==input[key])return false;
  if(input.attendees!==undefined){
    const actual=Array.isArray(event.attendees)?event.attendees.map(item=>String(record(item).email??"").toLowerCase()).sort():[];
    if(JSON.stringify(actual)!==JSON.stringify((input.attendees as string[]).toSorted()))return false;
  }
  if(input.recurrence!==undefined&&JSON.stringify(event.recurrence??[])!==JSON.stringify(input.recurrence))return false;
  if(input.reminders!==undefined){
    const expected=requestedReminders(input.reminders),actual=actualReminders(event.reminders);
    if(!expected||!actual||JSON.stringify(expected)!==JSON.stringify(actual))return false;
  }
  return true;
}
