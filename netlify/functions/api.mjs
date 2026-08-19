import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const STORE_NAME = 'team-comms-hub-v1'; // keep v1 so existing data survives the upgrade
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const emptyWorkspace = {updates:[],docs:[],decisions:[],activity:[]};

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers})}
function safeEqual(a,b){
  const aa=Buffer.from(String(a||'')); const bb=Buffer.from(String(b||''));
  return aa.length===bb.length && aa.length>0 && crypto.timingSafeEqual(aa,bb);
}
function auth(req){
  const supplied=req.headers.get('x-team-access-code')||'';
  const editor=process.env.TEAM_EDITOR_CODE||process.env.TEAM_ACCESS_CODE||'';
  const viewer=process.env.TEAM_VIEW_CODE||'';
  if(!editor&&!viewer) return {ok:true,role:'editor'}; // pilot compatibility; configure codes before sensitive use
  if(editor&&safeEqual(editor,supplied)) return {ok:true,role:'editor'};
  if(viewer&&safeEqual(viewer,supplied)) return {ok:true,role:'reader'};
  return {ok:false,role:null};
}
function actor(req){return (req.headers.get('x-team-display-name')||'Unknown user').slice(0,120)}
function labelFor(collection,item){return collection==='updates'?item?.title:collection==='docs'?item?.title:item?.decision}
function activity(action,collection,item,who){return {id:crypto.randomUUID(),at:new Date().toISOString(),action,collection,label:labelFor(collection,item)||'Untitled',actor:who}}
async function readData(store){
  const current=await store.get('workspace',{type:'json',consistency:'strong'});
  if(current){current.activity ||= [];current.updates ||= [];current.docs ||= [];current.decisions ||= [];return current}
  await store.setJSON('workspace',emptyWorkspace);return structuredClone(emptyWorkspace);
}
async function save(store,data){await store.setJSON('workspace',data)}

export default async req=>{
  const access=auth(req); if(!access.ok)return json({error:'Invalid workspace code.'},401);
  const url=new URL(req.url);
  const path=url.pathname.replace(/^\/api\/?/,'').replace(/^\.netlify\/functions\/api\/?/,'');
  const store=getStore({name:STORE_NAME,consistency:'strong'});
  const data=await readData(store);

  if(req.method==='GET'&&(path===''||path==='data')) return json({data,role:access.role});

  if(req.method==='POST'&&path==='ack'){
    const body=await req.json(); const item=data.updates.find(x=>x.id===body.updateId);
    if(!item)return json({error:'Update not found.'},404);
    item.acknowledgements ||= [];
    const who=actor(req);
    if(!item.acknowledgements.some(a=>a.name===who)) item.acknowledgements.push({name:who,at:new Date().toISOString()});
    data.activity.unshift(activity('acknowledged','updates',item,who));
    await save(store,data);return json({ok:true,data});
  }

  if(['POST','PUT','DELETE'].includes(req.method)&&path==='item'&&access.role!=='editor') return json({error:'Editor access required.'},403);

  if(req.method==='POST'&&path==='item'){
    const body=await req.json(); const collection=body.collection;
    if(!['updates','docs','decisions'].includes(collection))return json({error:'Invalid collection.'},400);
    const item={...body.item,id:body.item?.id||crypto.randomUUID()}; const now=new Date().toISOString();
    if(collection==='updates'){item.createdAt ||= now;item.updatedAt=now;item.acknowledgements ||= []}
    if(collection==='docs'){item.createdAt ||= now;item.updatedAt=now}
    if(collection==='decisions'){item.createdAt ||= now;item.updatedAt=now}
    item.history=[{at:now,actor:actor(req),action:'created'}];
    data[collection]=[item,...data[collection]];data.activity.unshift(activity('created',collection,item,actor(req)));
    await save(store,data);return json({item,data},201);
  }

  if(req.method==='PUT'&&path==='item'){
    const body=await req.json();const {collection,item}=body;
    if(!['updates','docs','decisions'].includes(collection)||!item?.id)return json({error:'Invalid request.'},400);
    const idx=data[collection].findIndex(x=>x.id===item.id);if(idx<0)return json({error:'Item not found.'},404);
    const old=data[collection][idx];const now=new Date().toISOString();
    const updated={...old,...item,updatedAt:now,history:[...(old.history||[]),{at:now,actor:actor(req),action:'updated',previous:{...old,history:undefined,acknowledgements:undefined}}]};
    data[collection][idx]=updated;data.activity.unshift(activity('updated',collection,updated,actor(req)));
    await save(store,data);return json({item:updated,data});
  }

  if(req.method==='DELETE'&&path==='item'){
    const body=await req.json();const {collection,id}=body;
    if(!['updates','docs','decisions'].includes(collection)||!id)return json({error:'Invalid request.'},400);
    const item=data[collection].find(x=>x.id===id);if(!item)return json({error:'Item not found.'},404);
    data[collection]=data[collection].filter(x=>x.id!==id);data.activity.unshift(activity('deleted',collection,item,actor(req)));
    await save(store,data);return json({ok:true,data});
  }
  return json({error:'Not found.'},404);
};
