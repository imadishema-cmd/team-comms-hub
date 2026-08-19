const state = {
  data: { updates: [], docs: [], decisions: [], activity: [] },
  view: 'home', filter: 'all', detail: null, edit: null,
  accessCode: sessionStorage.getItem('teamAccessCode') || '',
  displayName: sessionStorage.getItem('teamDisplayName') || '',
  role: 'reader'
};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
const fmt = d => d ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date(d)) : 'No date';
const api = async (path='data', opts={}) => {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: {
      'content-type':'application/json',
      'x-team-access-code': state.accessCode,
      'x-team-display-name': state.displayName,
      ...(opts.headers || {})
    }
  });
  const body = await res.json().catch(()=>({}));
  if(res.status === 401) throw new Error('ACCESS');
  if(res.status === 403) throw new Error('EDITOR');
  if(!res.ok) throw new Error(body.error || 'Request failed');
  return body;
};
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200)}
function empty(t){return `<p class="muted">${esc(t)}</p>`}
function updateRoleUI(){
  $('#roleLabel').textContent = `${state.displayName || 'Guest'} · ${state.role === 'editor' ? 'Editor' : 'Reader'}`;
  $$('.editor-only').forEach(el => el.classList.toggle('hidden', state.role !== 'editor'));
}
async function load(){
  try{
    const out = await api('data');
    state.data = out.data || out;
    state.role = out.role || 'reader';
    $('#accessGate').classList.add('hidden');
    updateRoleUI(); render();
  }catch(e){
    if(e.message === 'ACCESS' || !state.displayName) $('#accessGate').classList.remove('hidden');
    else toast(e.message);
  }
}
function render(){renderStats();renderHome();renderUpdates();renderDocs();renderDecisions();renderActivity()}
function renderStats(){
  const soon = [...state.data.updates,...state.data.docs,...state.data.decisions].filter(x=>x.reviewDate && new Date(x.reviewDate) < new Date(Date.now()+14*864e5)).length;
  const unread = state.data.updates.filter(x=>x.status==='Active' && !(x.acknowledgements||[]).some(a=>a.name===state.displayName)).length;
  $('#stats').innerHTML = [
    ['Active updates', state.data.updates.filter(x=>x.status==='Active').length],
    ['Knowledge pages', state.data.docs.filter(x=>x.status!=='Archived').length],
    ['Decisions', state.data.decisions.filter(x=>x.status!=='Archived').length],
    ['Unread / review', unread + soon]
  ].map(([a,b])=>`<div class="stat"><strong>${b}</strong><span>${a}</span></div>`).join('');
}
function row(c,id,title,sub,badge){return `<div class="list-row" data-open="${c}" data-id="${id}"><div><strong>${esc(title)}</strong><small>${esc(sub)}</small></div><span class="pill ${String(badge||'').toLowerCase()}">${esc(badge||'')}</span></div>`}
function renderHome(){
  const updates=[...state.data.updates].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5);
  $('#latestUpdates').innerHTML=updates.map(u=>row('updates',u.id,u.title,`${u.category} · ${fmt(u.createdAt)}`,u.priority)).join('')||empty('No updates yet.');
  const due=[
    ...state.data.updates.map(x=>({...x,_c:'updates',_t:x.title})),
    ...state.data.docs.map(x=>({...x,_c:'docs',_t:x.title})),
    ...state.data.decisions.map(x=>({...x,_c:'decisions',_t:x.decision}))
  ].filter(x=>x.reviewDate&&new Date(x.reviewDate)<new Date(Date.now()+14*864e5)).sort((a,b)=>new Date(a.reviewDate)-new Date(b.reviewDate)).slice(0,5);
  $('#reviewQueue').innerHTML=due.map(x=>row(x._c,x.id,x._t,`Review ${fmt(x.reviewDate)}`,x.status)).join('')||empty('Nothing due for review.');
  const docs=[...state.data.docs].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,3);
  $('#recentDocs').innerHTML=docs.map(docCard).join('')||empty('No knowledge pages yet.');
}
function renderUpdates(){
  let items=[...state.data.updates].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  if(state.filter!=='all') items=items.filter(x=>x.priority===state.filter||x.status===state.filter);
  $('#updatesList').innerHTML=items.map(u=>{
    const read=(u.acknowledgements||[]).some(a=>a.name===state.displayName);
    return `<article class="update-card" data-open="updates" data-id="${u.id}"><div class="date">${fmt(u.createdAt)}${read?'<br><span class="pill active" style="margin-top:8px">Read</span>':''}</div><div><div class="meta"><span>${esc(u.category)}</span><span>Owner: ${esc(u.owner)}</span></div><h3>${esc(u.title)}</h3><p>${esc(u.summary)}</p></div><div><span class="pill ${String(u.priority||'').toLowerCase()}">${esc(u.priority)}</span></div></article>`;
  }).join('')||empty('No updates match this filter.');
}
function docCard(d){return `<article class="doc-card" data-open="docs" data-id="${d.id}"><div class="meta"><span class="pill">${esc(d.type)}</span><span>${fmt(d.updatedAt)}</span></div><h4>${esc(d.title)}</h4><p>${esc((d.content||'').slice(0,150))}${(d.content||'').length>150?'…':''}</p><div class="meta"><span>${esc(d.owner)}</span><span class="pill ${String(d.status||'').toLowerCase()}">${esc(d.status)}</span></div></article>`}
function renderDocs(){$('#docsGrid').innerHTML=[...state.data.docs].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).map(docCard).join('')||empty('No knowledge pages yet.')}
function renderDecisions(){$('#decisionsList').innerHTML=[...state.data.decisions].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(d=>`<article class="decision" data-open="decisions" data-id="${d.id}"><div class="meta"><span>${fmt(d.createdAt)}</span><span class="pill ${String(d.status||'').toLowerCase()}">${esc(d.status)}</span></div><h3>${esc(d.decision)}</h3><div class="cols"><div><strong>Why</strong><br>${esc(d.reason)}</div><div><strong>Impact</strong><br>${esc(d.impact)}</div></div><div class="meta" style="margin-top:14px"><span>Owner: ${esc(d.owner)}</span><span>${d.reviewDate?'Review '+fmt(d.reviewDate):''}</span></div></article>`).join('')||empty('No decisions recorded yet.')}
function renderActivity(){
  const items=[...(state.data.activity||[])].sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,100);
  $('#activityList').innerHTML=items.map(a=>`<div class="activity-item"><span class="muted">${fmt(a.at)}</span><div><strong>${esc(a.actor||'Unknown')} ${esc(a.action||'changed')} ${esc(a.label||'an item')}</strong><span class="muted">${esc(a.collection||'')}</span></div><span class="pill">${esc(a.action||'')}</span></div>`).join('')||empty('No recorded changes yet.');
}
function setView(v){
  state.view=v;$$('.view').forEach(x=>x.classList.remove('active'));$(`#${v}View`).classList.add('active');
  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
  const titles={home:'What changed?',updates:'Updates',knowledge:'Knowledge',decisions:'Decisions',activity:'Activity',search:'Search'};
  $('#viewTitle').textContent=titles[v]||'Team Comms';
  $('#newItemBtn').textContent=v==='knowledge'?'+ New page':v==='decisions'?'+ Record decision':'+ New update';
}
const fields={
 updates:[['title','Title','text'],['summary','Summary','textarea'],['category','Category','select',['Announcement','Project Update','Operational Update','Decision','Process Change','Risk','Customer Update','Meeting Outcome']],['priority','Priority','select',['Critical','High','Medium','Low']],['owner','Owner','text'],['status','Status','select',['Draft','Active','Archived']],['reviewDate','Review date','date'],['link','Related link (Drive, Doc, ticket, etc.)','url'],['details','Additional details','textarea']],
 docs:[['title','Page title','text'],['content','Content','textarea'],['type','Type','select',['SOP','Reference','FAQ','Project','Meeting Notes']],['owner','Owner','text'],['status','Status','select',['Draft','Active','Archived']],['reviewDate','Review date','date'],['link','Related Google Drive / source link','url']],
 decisions:[['decision','Decision','textarea'],['reason','Why this decision','textarea'],['impact','Impact / what changes','textarea'],['owner','Owner','text'],['status','Status','select',['Active','Superseded','Archived']],['reviewDate','Review date','date'],['link','Related source / Drive link','url']]
};
function openDetail(collection,id){
  const item=state.data[collection]?.find(x=>x.id===id); if(!item)return;
  state.detail={collection,id};
  const isUpdate=collection==='updates';
  const title=isUpdate?item.title:collection==='docs'?item.title:item.decision;
  const description=isUpdate?(item.details||item.summary):collection==='docs'?item.content:`${item.reason||''}${item.impact?`\n\nImpact: ${item.impact}`:''}`;
  const type=isUpdate?item.category:collection==='docs'?item.type:'Decision';
  const date=item.updatedAt||item.createdAt;
  const acks=item.acknowledgements||[];
  $('#detailBody').innerHTML=`<div class="detail-head"><p class="eyebrow">${esc(type||collection)}</p><h2>${esc(title)}</h2><p class="detail-summary">${esc(description||'').replace(/\n/g,'<br>')}</p></div><div class="detail-grid"><div class="detail-cell"><small>Owner</small><strong>${esc(item.owner||'—')}</strong></div><div class="detail-cell"><small>Status</small><strong>${esc(item.status||'—')}</strong></div><div class="detail-cell"><small>Last change</small><strong>${fmt(date)}</strong></div><div class="detail-cell"><small>Review date</small><strong>${item.reviewDate?fmt(item.reviewDate):'Not set'}</strong></div></div>${item.link?`<a class="detail-link" href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">Open related resource ↗</a>`:''}${isUpdate?`<div class="ack-list"><h4>Read acknowledgements (${acks.length})</h4><div class="ack-chips">${acks.length?acks.map(a=>`<span class="ack-chip">${esc(a.name)}</span>`).join(''):'<span class="muted">No acknowledgements yet.</span>'}</div></div>`:''}`;
  $('#ackBtn').classList.toggle('hidden', !isUpdate || acks.some(a=>a.name===state.displayName));
  $('#editDetail').classList.toggle('hidden', state.role!=='editor');
  $('#detailModal').showModal();
}
function openEditor(collection,id=null){
  if(state.role!=='editor'){toast('Read-only access');return}
  const item=id?state.data[collection].find(x=>x.id===id):{};state.edit={collection,id};
  $('#modalEyebrow').textContent=id?'EDIT':'NEW';
  $('#modalTitle').textContent=collection==='updates'?(id?'Edit update':'Create update'):collection==='docs'?(id?'Edit knowledge page':'Create knowledge page'):(id?'Edit decision':'Record decision');
  $('#deleteItem').style.visibility=id?'visible':'hidden';
  $('#formFields').innerHTML=fields[collection].map(([k,l,t,opts],i)=>{const val=item?.[k]||'';if(t==='textarea')return `<div class="field"><label>${l}</label><textarea name="${k}" ${i===0?'required':''}>${esc(val)}</textarea></div>`;if(t==='select')return `<div class="field"><label>${l}</label><select name="${k}">${opts.map(o=>`<option ${o===val?'selected':''}>${o}</option>`).join('')}</select></div>`;return `<div class="field"><label>${l}</label><input name="${k}" type="${t}" value="${esc(val)}" ${i===0?'required':''}></div>`}).join('');
  $('#editorModal').showModal();
}
async function saveEditor(e){
  e.preventDefault(); if(state.role!=='editor')return;
  try{
    const item=Object.fromEntries(new FormData(e.currentTarget).entries()); if(state.edit.id)item.id=state.edit.id;
    const out=await api('item',{method:state.edit.id?'PUT':'POST',body:JSON.stringify({collection:state.edit.collection,item})});
    state.data=out.data;$('#editorModal').close();render();toast('Saved');
  }catch(err){toast(err.message==='EDITOR'?'Editor access required':err.message)}
}
async function removeEditor(){
  if(!state.edit.id||state.role!=='editor'||!confirm('Delete this item? The deletion will remain in the audit trail.'))return;
  try{const out=await api('item',{method:'DELETE',body:JSON.stringify({collection:state.edit.collection,id:state.edit.id})});state.data=out.data;$('#editorModal').close();render();toast('Deleted')}catch(err){toast(err.message)}
}
async function acknowledge(){
  if(!state.detail||!state.displayName)return;
  try{const out=await api('ack',{method:'POST',body:JSON.stringify({updateId:state.detail.id})});state.data=out.data;$('#detailModal').close();render();toast('Marked as read')}catch(err){toast(err.message)}
}
function search(q){
  q=q.trim().toLowerCase(); if(!q){setView('home');return}
  const results=[];
  state.data.updates.forEach(x=>{if(JSON.stringify(x).toLowerCase().includes(q))results.push({c:'updates',id:x.id,title:x.title,sub:x.summary})});
  state.data.docs.forEach(x=>{if(JSON.stringify(x).toLowerCase().includes(q))results.push({c:'docs',id:x.id,title:x.title,sub:x.content})});
  state.data.decisions.forEach(x=>{if(JSON.stringify(x).toLowerCase().includes(q))results.push({c:'decisions',id:x.id,title:x.decision,sub:x.reason})});
  $('#searchCount').textContent=`${results.length} found`;
  $('#searchResults').innerHTML=results.map(x=>row(x.c,x.id,x.title,(x.sub||'').slice(0,120),'Open')).join('')||empty('No matching content.');
  setView('search');
}
document.addEventListener('click',e=>{
  const nav=e.target.closest('[data-view]');if(nav)setView(nav.dataset.view);
  const jump=e.target.closest('[data-jump]');if(jump)setView(jump.dataset.jump);
  const create=e.target.closest('[data-create]');if(create)openEditor(create.dataset.create);
  const open=e.target.closest('[data-open]');if(open)openDetail(open.dataset.open,open.dataset.id);
  const filter=e.target.closest('[data-filter]');if(filter){state.filter=filter.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===filter));renderUpdates()}
});
$('#newItemBtn').addEventListener('click',()=>openEditor(state.view==='knowledge'?'docs':state.view==='decisions'?'decisions':'updates'));
$('#editorForm').addEventListener('submit',saveEditor);$('#deleteItem').addEventListener('click',removeEditor);$('#cancelModal').addEventListener('click',()=>$('#editorModal').close());$('#closeModal').addEventListener('click',()=>$('#editorModal').close());
$('#closeDetail').addEventListener('click',()=>$('#detailModal').close());$('#ackBtn').addEventListener('click',acknowledge);$('#editDetail').addEventListener('click',()=>{const d=state.detail;$('#detailModal').close();openEditor(d.collection,d.id)});
let searchTimer;$('#globalSearch').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>search(e.target.value),180)});
$('#accessForm').addEventListener('submit',async e=>{e.preventDefault();state.displayName=$('#displayName').value.trim();state.accessCode=$('#accessCode').value;sessionStorage.setItem('teamDisplayName',state.displayName);sessionStorage.setItem('teamAccessCode',state.accessCode);$('#accessError').textContent='';try{await load()}catch(err){$('#accessError').textContent='Could not sign in.'}});
$('#switchUser').addEventListener('click',()=>{sessionStorage.removeItem('teamDisplayName');sessionStorage.removeItem('teamAccessCode');state.displayName='';state.accessCode='';$('#displayName').value='';$('#accessCode').value='';$('#accessGate').classList.remove('hidden')});
if(state.displayName){$('#displayName').value=state.displayName;load()}else{$('#accessGate').classList.remove('hidden')}
