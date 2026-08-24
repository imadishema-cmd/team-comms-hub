export function cookie(name){
  const prefix=`${encodeURIComponent(name)}=`;
  return document.cookie.split('; ').find(part=>part.startsWith(prefix))?.slice(prefix.length)||'';
}

export class ApiError extends Error{
  constructor(message,status=0,code=''){super(message);this.name='ApiError';this.status=status;this.code=code;}
}

export async function api(path,{method='GET',body,headers={},raw=false,signal}={}){
  const upper=method.toUpperCase();
  const options={method:upper,credentials:'same-origin',headers:{...headers},signal};
  if(!['GET','HEAD','OPTIONS'].includes(upper)){
    options.headers['x-csrf-token']=decodeURIComponent(cookie('ccc_csrf')||'');
  }
  if(body!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(body);}
  let response;
  try{response=await fetch(`/api/${path}`,options);document.dispatchEvent(new CustomEvent('hub-online'));}
  catch(error){document.dispatchEvent(new CustomEvent('hub-offline'));throw new ApiError('Network unavailable. Check your connection and retry.',0,'NETWORK');}
  if(raw)return response;
  const text=await response.text();
  let payload={};
  if(text){try{payload=JSON.parse(text);}catch{payload={message:text};}}
  if(!response.ok){
    if(response.status===401)document.dispatchEvent(new CustomEvent('hub-auth-expired'));
    throw new ApiError(payload.error||payload.message||`Request failed (${response.status})`,response.status,payload.code||'');
  }
  return payload;
}

export const fetchWorkspace=(scope='all')=>api(`data?scope=${encodeURIComponent(scope)}`);
export const syncMeta=()=>api('sync');
export const searchWorkspace=q=>api(`search?q=${encodeURIComponent(q)}`);
