import { arr, canEdit, clean, contentLabel, isAdmin, now, uid } from './domain.mjs';
import { mutateCollection, readCollections } from './store.mjs';
import { authenticate, json, needAdmin, needEditor, needUser } from './security.mjs';
import { recordAudit } from './workspace.mjs';

function normalizeIncident(input, user, existing = null) {
  return {
    ...existing,
    ...input,
    id: existing?.id || uid(),
    title: clean(input.title, 250),
    severity: ['Critical','High','Medium','Low'].includes(input.severity) ? input.severity : 'Medium',
    status: ['Open','Investigating','Monitoring','Resolved','Archived'].includes(input.status) ? input.status : (existing?.status || 'Open'),
    owner: clean(input.owner || existing?.owner || user.name, 120),
    summary: clean(input.summary, 3000),
    details: clean(input.details, 16000),
    nextAction: clean(input.nextAction, 3000),
    dueAt: clean(input.dueAt, 60),
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
    createdBy: existing?.createdBy || user.id,
    history: [...arr(existing?.history), { at:now(), actor:user.name, actorId:user.id, action:existing?'updated':'created' }],
  };
}

function normalizeHandoff(input, user, existing = null) {
  return {
    ...existing,
    ...input,
    id: existing?.id || uid(),
    shiftDate: clean(input.shiftDate, 40),
    shiftName: clean(input.shiftName || 'Shift', 120),
    outgoing: clean(input.outgoing || user.name, 120),
    incoming: clean(input.incoming, 120),
    summary: clean(input.summary, 8000),
    outstanding: clean(input.outstanding, 8000),
    priorities: clean(input.priorities, 5000),
    status: ['Active','Completed','Archived'].includes(input.status) ? input.status : (existing?.status || 'Active'),
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
    createdBy: existing?.createdBy || user.id,
  };
}

function normalizeRoster(input, user, existing = null) {
  return {
    ...existing,
    ...input,
    id: existing?.id || uid(),
    name: clean(input.name, 120),
    userId: clean(input.userId, 100),
    role: clean(input.role, 120),
    startAt: clean(input.startAt, 60),
    endAt: clean(input.endAt, 60),
    notes: clean(input.notes, 2000),
    status: ['Active','Archived'].includes(input.status) ? input.status : (existing?.status || 'Active'),
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
    updatedBy: user.id,
  };
}

export async function handleOperations(req, path) {
  if (!path.startsWith('operations/')) return null;
  const { user } = await authenticate(req, { requireCsrf: !['GET','HEAD','OPTIONS'].includes(req.method) });
  needUser(user);

  if (req.method === 'GET' && path === 'operations/data') {
    const data = await readCollections(['incidents','handoffs','roster']);
    if (!canEdit(user)) {
      data.incidents = data.incidents.filter(item => item.status !== 'Archived');
      data.handoffs = data.handoffs.filter(item => item.status !== 'Archived');
      data.roster = data.roster.filter(item => item.status !== 'Archived');
    }
    return json({ data });
  }

  if (['POST','PUT'].includes(req.method) && path === 'operations/incident') {
    needEditor(user);
    const body = await req.json();
    let saved;
    await mutateCollection('incidents', items => {
      if (req.method === 'POST') {
        saved = normalizeIncident(body, user);
        if (!saved.title) throw Object.assign(new Error('Incident title is required.'), { status:400 });
        items.unshift(saved);
      } else {
        const index = items.findIndex(item => item.id === body.id);
        if (index < 0) throw Object.assign(new Error('Incident not found.'), { status:404 });
        if (!isAdmin(user) && items[index].createdBy && items[index].createdBy !== user.id) throw Object.assign(new Error('Editors can only edit incidents they created.'), { status:403 });
        saved = normalizeIncident(body,user,items[index]);
        items[index] = saved;
      }
    });
    await recordAudit(req.method==='POST'?'created':'updated','incidents',saved.title,user,`${saved.severity} · ${saved.status}`);
    return json({ item:saved,collection:'incidents' },req.method==='POST'?201:200);
  }

  if (req.method === 'DELETE' && path === 'operations/incident') {
    needEditor(user);
    const body = await req.json();
    let changed;
    await mutateCollection('incidents', items => {
      const item = items.find(entry => entry.id === body.id);
      if (!item) throw Object.assign(new Error('Incident not found.'),{status:404});
      item.status='Archived'; item.updatedAt=now(); changed=item;
    });
    await recordAudit('archived','incidents',changed.title,user);
    return json({ok:true,item:changed});
  }

  if (['POST','PUT'].includes(req.method) && path === 'operations/handoff') {
    needEditor(user);
    const body = await req.json();
    let saved;
    await mutateCollection('handoffs', items => {
      if(req.method==='POST'){ saved=normalizeHandoff(body,user); items.unshift(saved); }
      else { const index=items.findIndex(item=>item.id===body.id); if(index<0) throw Object.assign(new Error('Handoff not found.'),{status:404}); saved=normalizeHandoff(body,user,items[index]); items[index]=saved; }
    });
    await recordAudit(req.method==='POST'?'created':'updated','handoffs',contentLabel('handoffs',saved),user);
    return json({item:saved,collection:'handoffs'},req.method==='POST'?201:200);
  }

  if (req.method === 'DELETE' && path === 'operations/handoff') {
    needEditor(user);
    const body=await req.json(); let changed;
    await mutateCollection('handoffs',items=>{const item=items.find(entry=>entry.id===body.id);if(!item)throw Object.assign(new Error('Handoff not found.'),{status:404});item.status='Archived';item.updatedAt=now();changed=item;});
    await recordAudit('archived','handoffs',contentLabel('handoffs',changed),user);
    return json({ok:true,item:changed});
  }

  if (['POST','PUT'].includes(req.method) && path === 'operations/roster') {
    needAdmin(user);
    const body=await req.json();let saved;
    await mutateCollection('roster',items=>{if(req.method==='POST'){saved=normalizeRoster(body,user);if(!saved.name)throw Object.assign(new Error('Name is required.'),{status:400});items.unshift(saved);}else{const index=items.findIndex(item=>item.id===body.id);if(index<0)throw Object.assign(new Error('Roster entry not found.'),{status:404});saved=normalizeRoster(body,user,items[index]);items[index]=saved;}});
    await recordAudit(req.method==='POST'?'created':'updated','roster',saved.name,user);
    return json({item:saved,collection:'roster'},req.method==='POST'?201:200);
  }

  if(req.method==='DELETE'&&path==='operations/roster'){
    needAdmin(user);const body=await req.json();let changed;
    await mutateCollection('roster',items=>{const item=items.find(entry=>entry.id===body.id);if(!item)throw Object.assign(new Error('Roster entry not found.'),{status:404});item.status='Archived';item.updatedAt=now();changed=item;});
    await recordAudit('archived','roster',changed.name,user);return json({ok:true,item:changed});
  }

  return null;
}
