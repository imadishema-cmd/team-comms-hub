export const $=(selector,root=document)=>root.querySelector(selector);
export const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
export const arr=value=>Array.isArray(value)?value:[];
export const esc=value=>String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
export const nl2br=value=>esc(value).replace(/\n/g,'<br>');
export const fmt=value=>{if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?esc(value):date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});};
export const fmtTime=value=>{if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?esc(value):date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};
export const initials=name=>String(name||'U').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
export const isPast=value=>Boolean(value)&&new Date(value)<new Date();
export const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;

export function toast(message,type='info',timeout=4200){
  const region=$('#toastRegion'); if(!region)return;
  const item=document.createElement('div'); item.className=`toast ${type}`; item.setAttribute('role',type==='error'?'alert':'status');
  item.innerHTML=`<span>${esc(message)}</span><button type="button" aria-label="Dismiss notification">×</button>`;
  item.querySelector('button').addEventListener('click',()=>item.remove());region.append(item);
  setTimeout(()=>{item.classList.add('leaving');setTimeout(()=>item.remove(),220);},timeout);
}
export function setLoading(on,label='Loading…'){const el=$('#loadingOverlay');if(!el)return;el.querySelector('span').textContent=label;el.classList.toggle('hidden',!on);}
export function setOffline(on){$('#offlineBanner')?.classList.toggle('hidden',!on);}

export function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.readAsDataURL(file);});}

export function download(name,text,type='text/plain;charset=utf-8'){
  const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function toCsv(rows){
  if(!rows.length)return '';
  const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  return [headers.map(q).join(','),...rows.map(row=>headers.map(h=>q(row[h])).join(','))].join('\n');
}
export function downloadCsv(name,rows){download(name,toCsv(rows),'text/csv;charset=utf-8');}
export function downloadIcs(name,events){
  const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Zipline//Call Center Hub//EN','CALSCALE:GREGORIAN'];
  for(const event of events.filter(e=>e.date)){
    const d=new Date(event.date);if(Number.isNaN(d.getTime()))continue;
    lines.push('BEGIN:VEVENT',`UID:${event.id||crypto.randomUUID()}@call-center-hub`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(d)}`,`SUMMARY:${String(event.title||'Hub reminder').replace(/[;,\\]/g,'\\$&')}`,`DESCRIPTION:${String(event.description||'').replace(/\n/g,'\\n').replace(/[;,\\]/g,'\\$&')}`,'END:VEVENT');
  }
  lines.push('END:VCALENDAR');download(name,lines.join('\r\n'),'text/calendar;charset=utf-8');
}

export async function copyText(text){await navigator.clipboard.writeText(String(text||''));toast('Copied to clipboard.','success');}

export function parseCsv(text){
  const rows=[];let row=[],cell='',quote=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quote){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quote=false;else cell+=ch;}
    else if(ch==='"')quote=true;else if(ch===','){row.push(cell.trim());cell='';}else if(ch==='\n'){row.push(cell.trim());rows.push(row);row=[];cell='';}else if(ch!=='\r')cell+=ch;
  }
  if(cell||row.length){row.push(cell.trim());rows.push(row);}if(rows.length<2)return [];
  const headers=rows.shift().map(h=>h.trim().toLowerCase());return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
}


export async function initBrandAssets(){
  const official={
    hero:'https://res.cloudinary.com/flyzipline/video/upload/q_auto,f_auto,so_0/v1776784625/homepage_hero_desktop_21042026_rw2jvh.jpg'
  };
  document.querySelectorAll('img[data-fallback-src]').forEach(img=>{
    const fallback=img.dataset.fallbackSrc;
    const useFallback=()=>{if(fallback&&img.getAttribute('src')!==fallback)img.setAttribute('src',fallback);};
    img.addEventListener('error',useFallback,{once:true});
    if(img.complete&&img.naturalWidth===0)useFallback();
  });
  const probe=(url,timeout=4500)=>new Promise(resolve=>{
    const image=new Image();let done=false;
    const finish=ok=>{if(done)return;done=true;clearTimeout(timer);resolve(ok);};
    const timer=setTimeout(()=>finish(false),timeout);
    image.onload=()=>finish(true);image.onerror=()=>finish(false);image.referrerPolicy='no-referrer';image.src=url;
  });
  if(await probe(official.hero)){
    document.documentElement.style.setProperty('--zipline-hero-image',`url("${official.hero}")`);
  }
}

export function applyTheme(theme){const chosen=theme||localStorage.getItem('hub-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=chosen;localStorage.setItem('hub-theme',chosen);const use=$('#themeIcon use');if(use)use.setAttribute('href',chosen==='dark'?'#i-sun':'#i-moon');$('#themeToggle')?.setAttribute('aria-label',chosen==='dark'?'Switch to light theme':'Switch to dark theme');return chosen;}
