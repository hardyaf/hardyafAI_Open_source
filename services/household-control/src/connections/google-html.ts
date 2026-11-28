import { parseDocument } from "htmlparser2";

/** Inert parsing only: scripts/styles are omitted and no resource is fetched. */
export function googleHtmlText(html:string):string{
  const tree=parseDocument(html,{decodeEntities:true});
  const stack:any[]=[tree],parts:string[]=[];
  const ignored=new Set(['script','style','head','iframe','object','template']);
  const blocks=new Set(['p','div','li','tr','table','section','article','h1','h2','h3','h4','br','hr']);
  while(stack.length){
    const node=stack.pop();
    if(node.end){parts.push('\n');continue;}
    if(ignored.has(node.name))continue;
    if(node.type==='text'){parts.push(node.data);continue;}
    if(blocks.has(node.name)){parts.push('\n');stack.push({end:true});}
    if(node.name==='img'&&node.attribs?.alt)parts.push(node.attribs.alt);
    if(node.name==='a'&&typeof node.attribs?.href==='string'){
      try{const link=new URL(node.attribs.href);if(['http:','https:','mailto:'].includes(link.protocol))parts.push(' '+link.href+' ');}catch{}
    }
    if(Array.isArray(node.children))for(let i=node.children.length-1;i>=0;i--)stack.push(node.children[i]);
  }
  return parts.join('').replace(/[\t\f\v ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
