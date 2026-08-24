import {
  approvalDefault,
  assignedCourse,
  arr,
  bool,
  canEdit,
  clean,
  contentLabel,
  isAdmin,
  now,
  targetMatches,
  uid,
  validateUploadedFile,
  visibleItem,
} from './domain.mjs';
import {
  fileStore,
  mutateCollection,
  mutateProgress,
  oldFileStore,
  readAuth,
  readCollection,
  readCollections,
  readMeta,
  readProgress,
} from './store.mjs';
import { authenticate, json, needAdmin, needEditor, needUser } from './security.mjs';
import { notifyCriticalUpdate } from './notify.mjs';
import { notificationList, recordAudit, sanitizeWorkspace } from './workspace.mjs';

const CORE_COLLECTIONS = ['updates','docs','decisions','groups','courses','resources','quizzes','questionBank','activity','incidents','handoffs','roster','attachments'];

function queryScopes(url) {
  const raw = url.searchParams.get('scope');
  if (!raw || raw === 'all') return [...CORE_COLLECTIONS,'notifications','progress','me'];
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

function dependenciesForScopes(scopes) {
  const names = new Set(scopes.filter(name => CORE_COLLECTIONS.includes(name)));
  if (scopes.includes('notifications')) ['updates','docs','courses','incidents'].forEach(name => names.add(name));
  if (scopes.includes('resources')) names.add('courses');
  if (scopes.includes('attachments')) { names.add('updates'); names.add('docs'); }
  return [...names];
}

async function dataPayload(user, scopes) {
  const auth = await readAuth();
  const progress = await readProgress(user.id);
  const content = await readCollections(dependenciesForScopes(scopes));
  const data = await sanitizeWorkspace(content, auth, user, progress, scopes);
  return { data, meta: await readMeta() };
}

function formatItem(collection, body, user, existing = null) {
  const input = body.item || body;
  const base = existing || {};
  const common = {
    ...base,
    ...input,
    id: existing?.id || uid(),
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
    createdBy: existing?.createdBy || user.id,
    owner: clean(input.owner || existing?.owner || user.name, 120),
    approvalStatus: existing ? (isAdmin(user) ? (input.approvalStatus || existing.approvalStatus || 'approved') : approvalDefault(user)) : approvalDefault(user),
    status: ['Draft','Active','Archived'].includes(input.status) ? input.status : (existing?.status || 'Active'),
    targetGroupIds: arr(input.targetGroupIds),
    targetUserIds: arr(input.targetUserIds),
    attachmentIds: arr(input.attachmentIds),
    history: [...arr(existing?.history), { at: now(), actor: user.name, actorId: user.id, action: existing ? 'updated' : 'created' }],
  };
  if (collection === 'updates') return {
    ...common,
    title: clean(input.title, 250),
    summary: clean(input.summary, 2500),
    details: clean(input.details, 16000),
    category: clean(input.category || 'Announcement', 100),
    priority: ['Critical','High','Medium','Low'].includes(input.priority) ? input.priority : 'Medium',
    mandatory: bool(input.mandatory),
    pinned: bool(input.pinned),
    reviewDate: clean(input.reviewDate, 40),
    expiresAt: clean(input.expiresAt, 60),
    acknowledgements: arr(existing?.acknowledgements),
  };
  if (collection === 'docs') return {
    ...common,
    title: clean(input.title, 250),
    summary: clean(input.summary, 2500),
    content: clean(input.content, 50000),
    type: ['SOP','FAQ','Reference','Macro'].includes(input.type) ? input.type : 'Reference',
    reviewDate: clean(input.reviewDate, 40),
    version: existing ? Math.max(1, Number(existing.version || 1)) + 1 : 1,
    comments: arr(existing?.comments),
    outdatedFlags: arr(existing?.outdatedFlags),
  };
  return {
    ...common,
    decision: clean(input.decision, 5000),
    reason: clean(input.reason, 12000),
    impact: clean(input.impact, 12000),
    reviewDate: clean(input.reviewDate, 40),
  };
}

async function targetedUsers(item) {
  const auth = await readAuth();
  return auth.users.filter(user => user.status === 'active' && targetMatches(item, user));
}

function scoreSearch(item, fields, terms) {
  let score = 0;
  for (const term of terms) {
    let matched = false;
    fields.forEach((field, index) => {
      const value = String(item[field] || '').toLowerCase();
      if (!value.includes(term)) return;
      matched = true;
      score += index === 0 ? 12 : index === 1 ? 6 : 2;
      if (value.startsWith(term)) score += 4;
    });
    if (!matched) return 0;
  }
  return score;
}

function snippet(value, terms) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  let index = Math.min(...terms.map(term => {
    const found = lower.indexOf(term);
    return found < 0 ? lower.length : found;
  }));
  if (!Number.isFinite(index)) index = 0;
  const start = Math.max(0, index - 70);
  return `${start ? '…' : ''}${text.slice(start, start + 220)}${start + 220 < text.length ? '…' : ''}`;
}

export async function handleContent(req, path, url) {
  if (path.startsWith('auth/')) return null;
  const requireCsrf = !['GET','HEAD','OPTIONS'].includes(req.method);
  const { user, auth } = await authenticate(req, { requireCsrf });
  needUser(user);

  if (req.method === 'GET' && (path === '' || path === 'data')) {
    return json(await dataPayload(user, queryScopes(url)));
  }

  if (req.method === 'GET' && path === 'sync') {
    return json({ meta: await readMeta(), serverTime: now() });
  }

  if (req.method === 'GET' && path === 'list') {
    const collection = clean(url.searchParams.get('collection'), 40);
    if (!CORE_COLLECTIONS.includes(collection)) return json({ error:'Invalid collection.' },400);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const pageSize = Math.max(10, Math.min(100, Number(url.searchParams.get('pageSize') || 50)));
    const progress = await readProgress(user.id);
    const content = await readCollections([collection]);
    const scoped = await sanitizeWorkspace(content, auth, user, progress, [collection]);
    const all = arr(scoped[collection]);
    const start = (page - 1) * pageSize;
    return json({ items: all.slice(start, start + pageSize), page, pageSize, total: all.length, hasMore: start + pageSize < all.length, revision:(await readMeta()).revisions?.[collection] || 0 });
  }

  if (req.method === 'GET' && path === 'search') {
    const query = clean(url.searchParams.get('q'), 300).toLowerCase();
    if (query.length < 2) return json({ results: [] });
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 8);
    const content = await readCollections(['updates','docs','decisions','courses','incidents','handoffs']);
    const results = [];
    const push = (type, view, item, title, text, fields) => {
      if (!visibleItem(item, user) || !targetMatches(item, user)) return;
      const score = scoreSearch(item, fields, terms);
      if (!score) return;
      results.push({ type, view, itemId: item.id, title, snippet: snippet(text, terms), score, updatedAt: item.updatedAt || item.createdAt || '' });
    };
    for (const item of content.updates) push('Communication','communications',item,item.title,`${item.summary || ''} ${item.details || ''}`,['title','summary','details','owner','category']);
    for (const item of content.docs) push(item.type || 'Knowledge','knowledge',item,item.title,`${item.summary || ''} ${item.content || ''}`,['title','summary','content','owner','type']);
    for (const item of content.decisions) push('Decision','decisions',item,item.decision,`${item.reason || ''} ${item.impact || ''}`,['decision','reason','impact','owner']);
    for (const item of content.courses) {
      if (!isAdmin(user) && !assignedCourse(item,user)) continue;
      const score = scoreSearch(item,['title','description'],terms);
      if (score) results.push({ type:'Learning', view:'learning', itemId:item.id, title:item.title, snippet:snippet(item.description,terms), score, updatedAt:item.updatedAt || item.createdAt || '' });
    }
    for (const item of content.incidents) {
      const score = scoreSearch(item,['title','summary','details','owner','severity','status'],terms);
      if (score) results.push({ type:'Incident',view:'operations',itemId:item.id,title:item.title,snippet:snippet(`${item.summary || ''} ${item.details || ''}`,terms),score,updatedAt:item.updatedAt || item.createdAt || '' });
    }
    for (const item of content.handoffs) {
      const score = scoreSearch(item,['shiftName','summary','outstanding','outgoing','incoming'],terms);
      if (score) results.push({ type:'Handoff',view:'operations',itemId:item.id,title:`${item.shiftName || 'Shift'} handoff`,snippet:snippet(`${item.summary || ''} ${item.outstanding || ''}`,terms),score,updatedAt:item.updatedAt || item.createdAt || '' });
    }
    results.sort((a,b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return json({ results: results.slice(0, 60) });
  }

  if (req.method === 'POST' && path === 'ack') {
    const body = await req.json();
    let changed;
    await mutateCollection('updates', updates => {
      const item = updates.find(update => update.id === body.updateId);
      if (!item || !visibleItem(item, user) || !targetMatches(item, user)) throw Object.assign(new Error('Update not found.'), { status: 404 });
      item.acknowledgements ||= [];
      if (!item.acknowledgements.some(ack => ack.userId === user.id)) item.acknowledgements.push({ userId:user.id,name:user.name,email:user.email,at:now() });
      item.updatedAt = now();
      changed = item;
    });
    await recordAudit('acknowledged','updates',changed.title,user);
    return json({ ok:true,item:changed });
  }

  if (req.method === 'POST' && path === 'notifications/read') {
    const body = await req.json();
    const content = await readCollections(['updates','docs','courses','incidents']);
    const progress = await readProgress(user.id);
    const current = await notificationList(content, auth, user, progress);
    const { progress: updated } = await mutateProgress(user.id, state => {
      if (body.all) for (const notification of current) state.notificationReads[notification.id] = now();
      else if (body.id) state.notificationReads[clean(body.id, 500)] = now();
    });
    return json({ ok:true,notifications:await notificationList(content,auth,user,updated) });
  }

  if (['POST','PUT'].includes(req.method) && path === 'item') {
    needEditor(user);
    const body = await req.json();
    const collection = body.collection;
    if (!['updates','docs','decisions'].includes(collection)) return json({ error:'Invalid collection.' },400);
    let saved;
    await mutateCollection(collection, items => {
      if (req.method === 'POST') {
        const item = formatItem(collection, body, user);
        if (!(item.title || item.decision)) throw Object.assign(new Error('A title or decision is required.'), { status:400 });
        items.unshift(item);
        saved = item;
      } else {
        const input = body.item || {};
        const index = items.findIndex(item => item.id === input.id);
        if (index < 0) throw Object.assign(new Error('Item not found.'), { status:404 });
        const old = items[index];
        if (!isAdmin(user) && old.createdBy && old.createdBy !== user.id) throw Object.assign(new Error('Editors can only edit content they created.'), { status:403 });
        saved = formatItem(collection, body, user, old);
        if (collection === 'updates') saved.acknowledgements = old.acknowledgements || [];
        items[index] = saved;
      }
    });
    await recordAudit(req.method === 'POST'?'created':'updated',collection,contentLabel(collection,saved),user,saved.approvalStatus === 'pending'?'Awaiting approval':'Published');
    if (collection === 'updates' && saved.approvalStatus === 'approved' && (saved.mandatory || ['Critical','High'].includes(saved.priority))) {
      notifyCriticalUpdate(saved, await targetedUsers(saved)).catch(error => console.error('Notification delivery:', error));
    }
    return json({ item:saved,collection }, req.method === 'POST' ? 201 : 200);
  }

  if (req.method === 'DELETE' && path === 'item') {
    needEditor(user);
    const body = await req.json();
    const collection = body.collection;
    if (!['updates','docs','decisions'].includes(collection)) return json({ error:'Invalid collection.' },400);
    let archived;
    await mutateCollection(collection, items => {
      const item = items.find(entry => entry.id === body.id);
      if (!item) throw Object.assign(new Error('Item not found.'), { status:404 });
      if (!isAdmin(user) && item.createdBy && item.createdBy !== user.id) throw Object.assign(new Error('Editors can only archive content they created.'), { status:403 });
      item.status = 'Archived';
      item.updatedAt = now();
      archived = item;
    });
    await recordAudit('archived',collection,contentLabel(collection,archived),user);
    return json({ ok:true,item:archived,collection });
  }

  if (req.method === 'DELETE' && path === 'item/permanent') {
    needAdmin(user);
    const body = await req.json();
    if (body.collection !== 'updates') return json({ error:'Permanent deletion is only enabled for communications.' },400);
    let deleted;
    await mutateCollection('updates', updates => {
      const index = updates.findIndex(item => item.id === body.id);
      if (index < 0) throw Object.assign(new Error('Communication not found.'), { status:404 });
      [deleted] = updates.splice(index,1);
    });
    await recordAudit('permanently deleted','updates',deleted.title,user,'Communication and acknowledgement record removed');
    return json({ ok:true,id:deleted.id,collection:'updates' });
  }

  if (req.method === 'POST' && path === 'approve') {
    needAdmin(user);
    const body = await req.json();
    const collection = body.collection;
    if (!['updates','docs','decisions'].includes(collection) || !['approved','rejected'].includes(body.decision)) return json({ error:'Invalid approval action.' },400);
    let changed;
    await mutateCollection(collection, items => {
      const item = items.find(entry => entry.id === body.id);
      if (!item) throw Object.assign(new Error('Item not found.'), { status:404 });
      item.approvalStatus = body.decision;
      item.approvedBy = user.id;
      item.approvedAt = now();
      item.approvalNote = clean(body.note,1000);
      item.updatedAt = now();
      changed = item;
    });
    await recordAudit(body.decision,collection,contentLabel(collection,changed),user,changed.approvalNote);
    if (collection === 'updates' && body.decision === 'approved' && (changed.mandatory || ['Critical','High'].includes(changed.priority))) {
      notifyCriticalUpdate(changed, await targetedUsers(changed)).catch(error => console.error('Notification delivery:', error));
    }
    return json({ ok:true,item:changed,collection });
  }

  if (req.method === 'POST' && path === 'content/bulk') {
    needEditor(user);
    const body = await req.json();
    const collection = body.collection;
    if (!['updates','docs','decisions'].includes(collection)) return json({ error:'Invalid collection.' },400);
    const ids = new Set(arr(body.ids));
    let count = 0;
    await mutateCollection(collection, items => {
      for (const item of items) {
        if (!ids.has(item.id)) continue;
        if (!isAdmin(user) && item.createdBy && item.createdBy !== user.id) continue;
        if (body.action === 'archive') { item.status='Archived'; item.updatedAt=now(); count += 1; }
        if (body.action === 'restore' && isAdmin(user)) { item.status='Active'; item.updatedAt=now(); count += 1; }
      }
    });
    await recordAudit(`bulk ${body.action}`,collection,`${count} items`,user);
    return json({ ok:true,count,collection });
  }

  if (req.method === 'POST' && path === 'knowledge/comment') {
    const body = await req.json();
    let changed;
    await mutateCollection('docs', docs => {
      const doc = docs.find(item => item.id === body.docId);
      if (!doc || !visibleItem(doc,user) || !targetMatches(doc,user)) throw Object.assign(new Error('Knowledge item not found.'), { status:404 });
      doc.comments ||= [];
      doc.outdatedFlags ||= [];
      if (body.action === 'comment') doc.comments.push({ id:uid(),userId:user.id,name:user.name,text:clean(body.text,3000),at:now(),resolved:false });
      else if (body.action === 'flag') doc.outdatedFlags.push({ id:uid(),userId:user.id,name:user.name,text:clean(body.text,1500),at:now(),resolved:false });
      else if (body.action === 'resolve') {
        needEditor(user);
        const entry = [...doc.comments,...doc.outdatedFlags].find(item => item.id === body.entryId);
        if (entry) { entry.resolved=true; entry.resolvedAt=now(); entry.resolvedBy=user.name; }
      } else throw Object.assign(new Error('Unknown feedback action.'), { status:400 });
      doc.updatedAt = now();
      changed = doc;
    });
    await recordAudit(body.action === 'flag'?'flagged outdated':'commented','docs',changed.title,user,clean(body.text,500));
    return json({ ok:true,item:changed,collection:'docs' });
  }

  if (req.method === 'POST' && path === 'files/upload') {
    needEditor(user);
    const body = await req.json();
    const file = validateUploadedFile(body);
    const id = uid();
    const blobKey = `attachment-${id}`;
    const arrayBuffer = file.buffer.buffer.slice(file.buffer.byteOffset,file.buffer.byteOffset+file.buffer.byteLength);
    await fileStore().set(blobKey,arrayBuffer,{metadata:{mimeType:file.mimeType,fileName:file.fileName,inline:file.inline}});
    let attachment;
    await mutateCollection('attachments', list => {
      attachment = { id,title:clean(body.title || file.fileName,240),fileName:file.fileName,mimeType:file.mimeType,size:file.size,inline:file.inline,blobKey,fileStoreVersion:'v4',uploadedBy:user.name,uploadedById:user.id,createdAt:now(),status:'Active' };
      list.unshift(attachment);
    });
    await recordAudit('uploaded attachment','attachments',attachment.title,user);
    return json({ attachment:{...attachment,blobKey:undefined} },201);
  }

  if (req.method === 'GET' && path === 'files/open') {
    const id = clean(url.searchParams.get('id'),100);
    const [attachments,updates,docs] = await Promise.all([readCollection('attachments'),readCollection('updates'),readCollection('docs')]);
    const attachment = attachments.find(item => item.id === id);
    if (!attachment) return json({ error:'Attachment not found.' },404);
    const usedBy = [...updates,...docs].filter(item => arr(item.attachmentIds).includes(id));
    if (!isAdmin(user) && !canEdit(user) && !usedBy.some(item => visibleItem(item,user) && targetMatches(item,user))) return json({ error:'You do not have access to this attachment.' },403);
    const store = attachment.fileStoreVersion === 'v3' ? oldFileStore() : fileStore();
    let data;
    if (attachment.fileStoreVersion === 'v3') {
      const base64 = await store.get(attachment.blobKey,{type:'text',consistency:'strong'});
      if (base64) data = Buffer.from(base64,'base64');
    } else {
      const buffer = await store.get(attachment.blobKey,{type:'arrayBuffer',consistency:'strong'});
      if (buffer) data = Buffer.from(buffer);
    }
    if (!data) return json({ error:'File data is unavailable.' },404);
    const headers = new Headers({
      'content-type':attachment.mimeType || 'application/octet-stream',
      'content-disposition':`${attachment.inline ? 'inline' : 'attachment'}; filename="${attachment.fileName.replace(/"/g,'')}"`,
      'cache-control':'private, max-age=60',
      'x-content-type-options':'nosniff',
    });
    return new Response(data,{status:200,headers});
  }

  if (req.method === 'DELETE' && path === 'files/delete') {
    needAdmin(user);
    const body = await req.json();
    const [updates,docs] = await Promise.all([readCollection('updates'),readCollection('docs')]);
    if ([...updates,...docs].some(item => arr(item.attachmentIds).includes(body.id))) return json({error:'This attachment is still used by content. Remove it from the content first.'},409);
    let deleted;
    await mutateCollection('attachments', list => {
      const index=list.findIndex(item=>item.id===body.id);
      if(index<0) throw Object.assign(new Error('Attachment not found.'),{status:404});
      [deleted]=list.splice(index,1);
    });
    const store = deleted.fileStoreVersion === 'v3' ? oldFileStore() : fileStore();
    if(deleted.blobKey) await store.delete(deleted.blobKey);
    await recordAudit('deleted attachment','attachments',deleted.title,user);
    return json({ok:true,id:deleted.id});
  }

  return null;
}
