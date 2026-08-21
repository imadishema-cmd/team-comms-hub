import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const CONTENT_STORE = 'team-comms-hub-v1'; // preserve V1/V2 data
const AUTH_STORE = 'team-comms-hub-auth-v3';
const FILE_STORE = 'team-comms-hub-files-v3';
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const clean = (v,n=5000) => String(v ?? '').trim().slice(0,n);
const bool = v => v === true || v === 'true';
const arr = v => Array.isArray(v) ? v : [];
const json = (data,status=200,extra={}) => new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...extra}});

const defaultContent = {
  updates: [], docs: [], decisions: [], activity: [], groups: [], courses: [], quizzes: [], questionBank: [], resources: []
};
const defaultAuth = {users:[],sessions:{},progress:{},quizSessions:{},passwordResetRequests:[],notificationReads:{}};

function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
  const hash=crypto.scryptSync(password,salt,64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password,stored=''){
  const [salt,expected]=String(stored).split(':'); if(!salt||!expected) return false;
  const actual=crypto.scryptSync(password,salt,64).toString('hex');
  const a=Buffer.from(actual,'hex'), b=Buffer.from(expected,'hex');
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
function validatePassword(p){return typeof p==='string' && p.length>=10 && /[A-Za-z]/.test(p) && /\d/.test(p)}
function normalizeEmail(v){return clean(v,240).toLowerCase()}
function allowedEmail(email){
  const domains=clean(process.env.ALLOWED_EMAIL_DOMAINS||'',1000).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!domains.length)return true; const domain=email.split('@')[1]||''; return domains.includes(domain);
}
function sessionDays(){const d=Number(process.env.SESSION_DAYS||14);return Number.isFinite(d)&&d>0?Math.min(d,90):14}
function maxUploadBytes(){const m=Number(process.env.MAX_UPLOAD_MB||4);return Math.max(1,Math.min(m,8))*1024*1024}
function audit(content,action,collection,label,user,detail=''){
  content.activity ||= [];
  content.activity.unshift({id:uid(),at:now(),action,collection,label:clean(label,300)||'Untitled',actor:user?.name||'System',actorId:user?.id||null,detail:clean(detail,600)});
  content.activity=content.activity.slice(0,3000);
}
function publicUser(u){return {id:u.id,name:u.name,email:u.email,role:u.role,status:u.status,groupIds:arr(u.groupIds),createdAt:u.createdAt,lastLoginAt:u.lastLoginAt||null};}
function canEdit(user){return ['editor','admin'].includes(user?.role)}
function isAdmin(user){return user?.role==='admin'}
function contentLabel(collection,item){return collection==='updates'?item.title:collection==='docs'?item.title:collection==='decisions'?item.decision:item.title}
function approvalDefault(user){return isAdmin(user)?'approved':'pending'}
function visibleItem(item,user){
  if(isAdmin(user)||canEdit(user)) return true;
  if(item.status==='Archived'||item.status==='Draft') return false;
  if(item.expiresAt && new Date(item.expiresAt) < new Date()) return false;
  return (item.approvalStatus||'approved')==='approved';
}
function targetMatches(item,user){
  const groups=arr(item.targetGroupIds); const users=arr(item.targetUserIds);
  if(!groups.length&&!users.length)return true;
  return users.includes(user.id) || groups.some(g=>arr(user.groupIds).includes(g));
}
function sanitizeQuestion(q){return {id:q.id,type:q.type,prompt:q.prompt,options:arr(q.options),tags:arr(q.tags)};}

async function readJSON(store,key,fallback){
  const value=await store.get(key,{type:'json',consistency:'strong'}); return value||structuredClone(fallback);
}
async function writeJSON(store,key,value){await store.setJSON(key,value)}
async function loadContent(store){
  const c=await readJSON(store,'workspace',defaultContent);
  for(const k of Object.keys(defaultContent)) if(c[k]===undefined)c[k]=structuredClone(defaultContent[k]);
  // migrate older objects
  c.updates=arr(c.updates).map(x=>({...x,approvalStatus:x.approvalStatus||'approved',mandatory:!!x.mandatory,pinned:!!x.pinned,targetGroupIds:arr(x.targetGroupIds),targetUserIds:arr(x.targetUserIds),acknowledgements:arr(x.acknowledgements)}));
  c.docs=arr(c.docs).map(x=>({...x,approvalStatus:x.approvalStatus||'approved',version:x.version||1,targetGroupIds:arr(x.targetGroupIds)}));
  c.decisions=arr(c.decisions).map(x=>({...x,approvalStatus:x.approvalStatus||'approved',targetGroupIds:arr(x.targetGroupIds)}));
  c.resources=arr(c.resources).map(x=>({...x,status:x.status||'Active',description:x.description||'',category:x.category||'General',version:x.version||1,reviewDate:x.reviewDate||'',updatedAt:x.updatedAt||x.createdAt||now()}));
  return c;
}
async function loadAuth(store){
  const a=await readJSON(store,'auth',defaultAuth);
  for(const k of Object.keys(defaultAuth)) if(a[k]===undefined)a[k]=structuredClone(defaultAuth[k]);
  return a;
}
function cleanupSessions(auth){
  const t=Date.now(); for(const [token,s] of Object.entries(auth.sessions||{}))if(new Date(s.expiresAt).getTime()<t)delete auth.sessions[token];
  for(const [token,s] of Object.entries(auth.quizSessions||{}))if(new Date(s.expiresAt).getTime()<t)delete auth.quizSessions[token];
}
async function authenticate(req,authStore){
  const auth=await loadAuth(authStore); cleanupSessions(auth);
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)return {auth,user:null,token:null};
  const session=auth.sessions[token]; if(!session)return {auth,user:null,token:null};
  const user=auth.users.find(u=>u.id===session.userId); if(!user||user.status!=='active')return {auth,user:null,token:null};
  return {auth,user,token};
}
function needUser(user){if(!user)throw Object.assign(new Error('Please sign in.'),{status:401})}
function needEditor(user){needUser(user);if(!canEdit(user))throw Object.assign(new Error('Editor access required.'),{status:403})}
function needAdmin(user){needUser(user);if(!isAdmin(user))throw Object.assign(new Error('Admin access required.'),{status:403})}
function userProgress(auth,userId){
  auth.progress[userId] ||= {resources:{},modules:{},courses:{},quizAttempts:{}};
  const p=auth.progress[userId]; p.resources||={};p.modules||={};p.courses||={};p.quizAttempts||={};return p;
}
function computeCourseProgress(course,p){
  const modules=arr(course.modules); if(!modules.length)return {percent:0,completed:false,completedCount:0,total:0};
  let completed=0;
  for(const m of modules){if(p.modules?.[`${course.id}:${m.id}`]?.completed)completed++;}
  return {percent:Math.round(completed/modules.length*100),completed:completed===modules.length,completedCount:completed,total:modules.length};
}
function assignedCourse(course,user){
  if(course.status!=='Active')return false;
  const ug=arr(user.groupIds), cg=arr(course.assignedGroupIds), cu=arr(course.assignedUserIds);
  if(!cg.length&&!cu.length)return true;
  return cu.includes(user.id)||cg.some(g=>ug.includes(g));
}
function notificationList(content,auth,user){
  const p=userProgress(auth,user.id); const items=[];
  auth.notificationReads ||= {}; auth.notificationReads[user.id] ||= {};
  const seen=auth.notificationReads[user.id];
  for(const u of content.updates.filter(x=>visibleItem(x,user)&&targetMatches(x,user)&&x.status==='Active')){
    const read=arr(u.acknowledgements).some(a=>a.userId===user.id || (!a.userId&&a.name===user.name));
    if(u.mandatory&&!read)items.push({id:`update:${u.id}`,type:'mandatory',title:'Acknowledgement required',text:u.title,view:'communications',itemId:u.id,priority:u.priority||'High'});
  }
  for(const d of content.docs.filter(x=>visibleItem(x,user)&&targetMatches(x,user))){
    if(d.reviewDate && new Date(d.reviewDate) < new Date(Date.now()+14*864e5)) items.push({id:`doc:${d.id}:${d.reviewDate||''}`,type:'review',title:'Knowledge review due',text:d.title,view:'knowledge',itemId:d.id,priority:new Date(d.reviewDate)<new Date()?'High':'Normal'});
  }
  for(const u of content.updates.filter(x=>visibleItem(x,user)&&targetMatches(x,user))){
    if(u.reviewDate && new Date(u.reviewDate) < new Date(Date.now()+14*864e5)) items.push({id:`review:${u.id}:${u.reviewDate||''}`,type:'review',title:'Communication review due',text:u.title,view:'communications',itemId:u.id,priority:new Date(u.reviewDate)<new Date()?'High':'Normal'});
  }
  for(const c of content.courses.filter(x=>assignedCourse(x,user))){
    const cp=computeCourseProgress(c,p); if(cp.completed)continue;
    if(c.dueDate && new Date(c.dueDate)<new Date()) items.push({id:`course:${c.id}:${c.dueDate||'assigned'}`,type:'overdue',title:'Learning overdue',text:c.title,view:'learning',itemId:c.id,priority:'High'});
    else items.push({id:`course:${c.id}:${c.dueDate||'assigned'}`,type:'learning',title:'Learning assigned',text:c.title,view:'learning',itemId:c.id,priority:'Normal'});
  }
  if(isAdmin(user)){
    const approvals=[...content.updates,...content.docs,...content.decisions].filter(x=>x.approvalStatus==='pending').length;
    if(approvals)items.push({id:`approvals:${approvals}:${[...content.updates,...content.docs,...content.decisions].filter(x=>x.approvalStatus==='pending').map(x=>x.updatedAt||x.createdAt||'').sort().at(-1)||''}`,type:'admin',title:'Content awaiting approval',text:`${approvals} item${approvals===1?'':'s'} need review.`,view:'admin',priority:'High'});
    const pending=auth.users.filter(x=>x.status==='pending').length;
    if(pending)items.push({id:`users:${pending}:${auth.users.filter(x=>x.status==='pending').map(x=>x.createdAt||'').sort().at(-1)||''}`,type:'admin',title:'Account approvals',text:`${pending} account${pending===1?'':'s'} waiting.`,view:'admin',priority:'Normal'});
  }
  return items.filter(x=>!seen[x.id]);
}
function sanitizeWorkspace(content,auth,user){
  const p=userProgress(auth,user.id);
  const updates=content.updates.filter(x=>visibleItem(x,user)&&targetMatches(x,user));
  const docs=content.docs.filter(x=>visibleItem(x,user)&&targetMatches(x,user));
  const decisions=content.decisions.filter(x=>visibleItem(x,user)&&targetMatches(x,user));
  const courses=content.courses.filter(x=>isAdmin(user)||assignedCourse(x,user)).map(c=>({...c,progress:computeCourseProgress(c,p)}));
  const resources=content.resources.map(r=>({id:r.id,title:r.title,fileName:r.fileName,mimeType:r.mimeType,size:r.size,createdAt:r.createdAt,updatedAt:r.updatedAt||r.createdAt,uploadedBy:r.uploadedBy,status:r.status||'Active',description:r.description||'',category:r.category||'General',version:r.version||1,reviewDate:r.reviewDate||''}));
  return {updates,docs,decisions,groups:content.groups,courses,resources,quizzes:isAdmin(user)?content.quizzes:[],questionBank:isAdmin(user)?content.questionBank:[],activity:isAdmin(user)?content.activity.slice(0,500):[],notifications:notificationList(content,auth,user),me:publicUser(user),progress:p};
}

function routePath(req){
  const u=new URL(req.url); return u.pathname.replace(/^\/api\/?/,'').replace(/^\/\.netlify\/functions\/api\/?/,'').replace(/^\//,'');
}

export default async req=>{
  try{
    const path=routePath(req), url=new URL(req.url);
    const contentStore=getStore({name:CONTENT_STORE,consistency:'strong'});
    const authStore=getStore({name:AUTH_STORE,consistency:'strong'});
    const fileStore=getStore({name:FILE_STORE,consistency:'strong'});
    const content=await loadContent(contentStore);
    let {auth,user,token}=await authenticate(req,authStore);

    // AUTH ------------------------------------------------------------------
    if(req.method==='POST'&&path==='auth/signup'){
      const b=await req.json(); const name=clean(b.name,120), email=normalizeEmail(b.email), password=String(b.password||'');
      if(name.length<2||!email.includes('@'))return json({error:'Enter a valid name and email.'},400);
      if(!allowedEmail(email))return json({error:'This email domain is not allowed to register.'},403);
      if(!validatePassword(password))return json({error:'Password must be at least 10 characters and include a letter and a number.'},400);
      auth=await loadAuth(authStore); if(auth.users.some(u=>u.email===email))return json({error:'An account already exists for this email.'},409);
      const isFirst=auth.users.length===0; const bootstrap=normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL||'');
      let role='viewer', status=bool(process.env.REQUIRE_ADMIN_APPROVAL)?'pending':'active';
      if(isFirst){
        if(bootstrap&&email!==bootstrap)return json({error:'The initial administrator account must be created with the configured bootstrap email.'},403);
        role='admin';status='active';
      }
      const newUser={id:uid(),name,email,passwordHash:hashPassword(password),role,status,groupIds:[],createdAt:now(),lastLoginAt:null};
      auth.users.push(newUser); await writeJSON(authStore,'auth',auth);
      audit(content,'registered','users',email,newUser,status==='pending'?'Pending approval':'Account active');await writeJSON(contentStore,'workspace',content);
      return json({ok:true,status,role,message:status==='pending'?'Account created and awaiting admin approval.':'Account created. You can sign in.'},201);
    }
    if(req.method==='POST'&&path==='auth/login'){
      const b=await req.json(); const email=normalizeEmail(b.email), password=String(b.password||''); auth=await loadAuth(authStore);
      const u=auth.users.find(x=>x.email===email); if(!u||!verifyPassword(password,u.passwordHash))return json({error:'Incorrect email or password.'},401);
      if(u.status==='pending')return json({error:'Your account is awaiting administrator approval.'},403);
      if(u.status!=='active')return json({error:'This account is not active.'},403);
      const t=crypto.randomBytes(32).toString('hex'); const expiresAt=new Date(Date.now()+sessionDays()*864e5).toISOString();
      auth.sessions[t]={userId:u.id,createdAt:now(),expiresAt};u.lastLoginAt=now();await writeJSON(authStore,'auth',auth);
      return json({token:t,expiresAt,user:publicUser(u)});
    }
    if(req.method==='POST'&&path==='auth/logout'){
      if(token){delete auth.sessions[token];await writeJSON(authStore,'auth',auth);}return json({ok:true});
    }
    if(req.method==='POST'&&path==='auth/request-reset'){
      const b=await req.json();const email=normalizeEmail(b.email);auth=await loadAuth(authStore);const u=auth.users.find(x=>x.email===email);
      if(u&&!auth.passwordResetRequests.some(r=>r.userId===u.id&&r.status==='open'))auth.passwordResetRequests.unshift({id:uid(),userId:u.id,email,status:'open',createdAt:now()});
      await writeJSON(authStore,'auth',auth);return json({ok:true,message:'If that account exists, an administrator can now reset its password.'});
    }
    if(req.method==='GET'&&path==='me'){
      needUser(user); return json({user:publicUser(user)});
    }

    needUser(user);

    // WORKSPACE --------------------------------------------------------------
    if(req.method==='GET'&&(path===''||path==='data')) return json({data:sanitizeWorkspace(content,auth,user)});

    if(req.method==='POST'&&path==='ack'){
      const b=await req.json();const item=content.updates.find(x=>x.id===b.updateId);if(!item||!visibleItem(item,user)||!targetMatches(item,user))return json({error:'Update not found.'},404);
      item.acknowledgements ||= []; if(!item.acknowledgements.some(a=>a.userId===user.id))item.acknowledgements.push({userId:user.id,name:user.name,email:user.email,at:now()});
      audit(content,'acknowledged','updates',item.title,user);await writeJSON(contentStore,'workspace',content);return json({ok:true,data:sanitizeWorkspace(content,auth,user)});
    }

    if(req.method==='POST'&&path==='notifications/read'){
      const b=await req.json(); auth.notificationReads ||= {}; auth.notificationReads[user.id] ||= {};
      const current=notificationList(content,auth,user);
      if(b.all){ for(const n of current) auth.notificationReads[user.id][n.id]=now(); }
      else if(b.id){ auth.notificationReads[user.id][clean(b.id,500)]=now(); }
      await writeJSON(authStore,'auth',auth);
      return json({ok:true,data:sanitizeWorkspace(content,auth,user)});
    }

    if(req.method==='POST'&&path==='item'){
      needEditor(user);const b=await req.json();const collection=b.collection;if(!['updates','docs','decisions'].includes(collection))return json({error:'Invalid collection.'},400);
      const i={...b.item,id:uid(),createdAt:now(),updatedAt:now(),createdBy:user.id,owner:clean(b.item?.owner||user.name,120),approvalStatus:approvalDefault(user),history:[{at:now(),actor:user.name,actorId:user.id,action:'created'}]};
      if(collection==='updates'){i.title=clean(i.title,250);i.summary=clean(i.summary,2000);i.details=clean(i.details,10000);i.acknowledgements=[];i.mandatory=bool(i.mandatory);i.pinned=bool(i.pinned);i.targetGroupIds=arr(i.targetGroupIds);i.targetUserIds=arr(i.targetUserIds);}
      if(collection==='docs'){i.title=clean(i.title,250);i.content=clean(i.content,30000);i.version=1;i.targetGroupIds=arr(i.targetGroupIds);}
      if(collection==='decisions'){i.decision=clean(i.decision,4000);i.reason=clean(i.reason,8000);i.impact=clean(i.impact,8000);i.targetGroupIds=arr(i.targetGroupIds);}
      content[collection].unshift(i);audit(content,'created',collection,contentLabel(collection,i),user,i.approvalStatus==='pending'?'Awaiting approval':'Published');await writeJSON(contentStore,'workspace',content);
      return json({item:i,data:sanitizeWorkspace(content,auth,user)},201);
    }
    if(req.method==='PUT'&&path==='item'){
      needEditor(user);const b=await req.json(),collection=b.collection,item=b.item;if(!['updates','docs','decisions'].includes(collection)||!item?.id)return json({error:'Invalid request.'},400);
      const idx=content[collection].findIndex(x=>x.id===item.id);if(idx<0)return json({error:'Item not found.'},404);const old=content[collection][idx];
      if(!isAdmin(user)&&old.createdBy&&old.createdBy!==user.id)return json({error:'Editors can only edit content they created.'},403);
      const previous={...old,history:undefined,acknowledgements:undefined}; const updated={...old,...item,id:old.id,createdAt:old.createdAt,updatedAt:now(),history:[...arr(old.history),{at:now(),actor:user.name,actorId:user.id,action:'updated',previous}]};
      if(collection==='docs' && (item.content!==undefined||item.title!==undefined))updated.version=(old.version||1)+1;
      if(!isAdmin(user))updated.approvalStatus='pending';
      content[collection][idx]=updated;audit(content,'updated',collection,contentLabel(collection,updated),user,updated.approvalStatus==='pending'?'Returned to approval queue':'');await writeJSON(contentStore,'workspace',content);
      return json({item:updated,data:sanitizeWorkspace(content,auth,user)});
    }
    if(req.method==='DELETE'&&path==='item'){
      needAdmin(user);const b=await req.json(),collection=b.collection,id=b.id;if(!['updates','docs','decisions'].includes(collection))return json({error:'Invalid collection.'},400);
      const idx=content[collection].findIndex(x=>x.id===id);if(idx<0)return json({error:'Item not found.'},404);const item=content[collection][idx];
      item.status='Archived';item.archivedAt=now();item.updatedAt=now();audit(content,'archived',collection,contentLabel(collection,item),user);await writeJSON(contentStore,'workspace',content);return json({ok:true,data:sanitizeWorkspace(content,auth,user)});
    }
    if(req.method==='POST'&&path==='approve'){
      needAdmin(user);const b=await req.json(),collection=b.collection,id=b.id,decision=b.decision;if(!['updates','docs','decisions'].includes(collection)||!['approved','rejected'].includes(decision))return json({error:'Invalid approval action.'},400);
      const item=content[collection].find(x=>x.id===id);if(!item)return json({error:'Item not found.'},404);item.approvalStatus=decision;item.approvedBy=user.id;item.approvedAt=now();item.approvalNote=clean(b.note,1000);item.updatedAt=now();
      audit(content,decision,collection,contentLabel(collection,item),user,item.approvalNote);await writeJSON(contentStore,'workspace',content);return json({ok:true,data:sanitizeWorkspace(content,auth,user)});
    }

    // ADMIN USERS + GROUPS ---------------------------------------------------
    if(req.method==='GET'&&path==='admin/users'){
      needAdmin(user);auth=await loadAuth(authStore);return json({users:auth.users.map(publicUser),resetRequests:auth.passwordResetRequests||[]});
    }
    if(req.method==='POST'&&path==='admin/user'){
      needAdmin(user);const b=await req.json();auth=await loadAuth(authStore);const u=auth.users.find(x=>x.id===b.userId);if(!u)return json({error:'User not found.'},404);
      if(b.action==='role'){
        if(!['viewer','editor','admin'].includes(b.role))return json({error:'Invalid role.'},400);
        if(u.id===user.id&&b.role!=='admin'&&auth.users.filter(x=>x.role==='admin'&&x.status==='active').length<=1)return json({error:'At least one active Admin must remain.'},400);
        u.role=b.role;audit(content,'changed role','users',u.email,user,`Role: ${b.role}`);
      } else if(b.action==='status'){
        if(!['active','pending','suspended'].includes(b.status))return json({error:'Invalid status.'},400);if(u.id===user.id&&b.status!=='active')return json({error:'You cannot suspend your own account.'},400);u.status=b.status;audit(content,'changed status','users',u.email,user,`Status: ${b.status}`);
      } else if(b.action==='groups'){
        u.groupIds=arr(b.groupIds).filter(id=>content.groups.some(g=>g.id===id));audit(content,'changed groups','users',u.email,user,`${u.groupIds.length} groups`);
      } else if(b.action==='reset-password'){
        const p=String(b.password||'');if(!validatePassword(p))return json({error:'Temporary password must be at least 10 characters and include a letter and number.'},400);u.passwordHash=hashPassword(p);for(const [t,s] of Object.entries(auth.sessions))if(s.userId===u.id)delete auth.sessions[t];for(const r of auth.passwordResetRequests||[])if(r.userId===u.id&&r.status==='open'){r.status='resolved';r.resolvedAt=now();}audit(content,'reset password','users',u.email,user);
      } else return json({error:'Unknown action.'},400);
      await writeJSON(authStore,'auth',auth);await writeJSON(contentStore,'workspace',content);return json({ok:true,users:auth.users.map(publicUser)});
    }
    if(req.method==='POST'&&path==='admin/group'){
      needAdmin(user);const b=await req.json();if(b.action==='create'){const g={id:uid(),name:clean(b.name,120),description:clean(b.description,500),createdAt:now()};if(!g.name)return json({error:'Group name is required.'},400);content.groups.push(g);audit(content,'created','groups',g.name,user);}
      else if(b.action==='update'){const g=content.groups.find(x=>x.id===b.id);if(!g)return json({error:'Group not found.'},404);g.name=clean(b.name,120)||g.name;g.description=clean(b.description,500);audit(content,'updated','groups',g.name,user);}
      else if(b.action==='delete'){const g=content.groups.find(x=>x.id===b.id);if(!g)return json({error:'Group not found.'},404);content.groups=content.groups.filter(x=>x.id!==b.id);auth=await loadAuth(authStore);for(const u of auth.users)u.groupIds=arr(u.groupIds).filter(x=>x!==b.id);await writeJSON(authStore,'auth',auth);audit(content,'deleted','groups',g.name,user);}
      else return json({error:'Unknown action.'},400);await writeJSON(contentStore,'workspace',content);return json({ok:true,groups:content.groups});
    }

    // LEARNING ADMIN ---------------------------------------------------------
    if(req.method==='POST'&&path==='learning/resource-upload'){
      needAdmin(user);const b=await req.json();const fileName=clean(b.fileName,240),mimeType=clean(b.mimeType,120)||'application/octet-stream',title=clean(b.title||fileName,240);const data=String(b.dataBase64||'');
      const bytes=Math.floor(data.length*3/4);if(!data||bytes>maxUploadBytes())return json({error:`File is empty or exceeds the ${Math.round(maxUploadBytes()/1024/1024)} MB upload limit.`},413);
      const existing=b.id?content.resources.find(x=>x.id===b.id):null;
      if(existing){
        await fileStore.set(existing.blobKey,data,{metadata:{mimeType,fileName}});existing.fileName=fileName;existing.mimeType=mimeType;existing.size=bytes;existing.title=title||existing.title;existing.description=clean(b.description,2000)||existing.description||'';existing.category=clean(b.category,120)||existing.category||'General';existing.reviewDate=clean(b.reviewDate,40)||existing.reviewDate||'';existing.version=Math.max(1,Number(existing.version||1))+1;existing.status='Active';existing.updatedAt=now();audit(content,'replaced file','learning',existing.title,user,`Version ${existing.version}`);await writeJSON(contentStore,'workspace',content);return json({resource:{...existing,blobKey:undefined},data:sanitizeWorkspace(content,auth,user)});
      }
      const id=uid(),key=`resource-${id}`;await fileStore.set(key,data,{metadata:{mimeType,fileName}});const r={id,title,fileName,mimeType,size:bytes,blobKey:key,uploadedBy:user.name,uploadedById:user.id,createdAt:now(),updatedAt:now(),status:'Active',description:clean(b.description,2000),category:clean(b.category,120)||'General',version:Math.max(1,Number(b.version||1)),reviewDate:clean(b.reviewDate,40)};content.resources.unshift(r);audit(content,'uploaded','learning',title,user);await writeJSON(contentStore,'workspace',content);return json({resource:{...r,blobKey:undefined},data:sanitizeWorkspace(content,auth,user)},201);
    }
    if(req.method==='POST'&&path==='learning/resource-manage'){
      needAdmin(user);const b=await req.json();const r=content.resources.find(x=>x.id===b.id);if(!r)return json({error:'Resource not found.'},404);const using=content.courses.filter(c=>arr(c.modules).some(m=>m.type==='resource'&&m.resourceId===r.id));
      if(b.action==='update'){r.title=clean(b.title,240)||r.title;r.description=clean(b.description,2000);r.category=clean(b.category,120)||'General';r.reviewDate=clean(b.reviewDate,40);r.updatedAt=now();audit(content,'updated metadata','learning',r.title,user);}
      else if(b.action==='archive'){r.status='Archived';r.updatedAt=now();audit(content,'archived','learning',r.title,user,`${using.length} course(s) reference this resource`);}
      else if(b.action==='restore'){r.status='Active';r.updatedAt=now();audit(content,'restored','learning',r.title,user);}
      else if(b.action==='delete'){
        if(using.length)return json({error:`This document is used in ${using.length} course${using.length===1?'':'s'}. Remove or replace it in those courses before permanently deleting it.`,usedBy:using.map(c=>({id:c.id,title:c.title}))},409);
        if(r.blobKey)await fileStore.delete(r.blobKey);content.resources=content.resources.filter(x=>x.id!==r.id);auth=await loadAuth(authStore);for(const p of Object.values(auth.progress||{}))if(p.resources)delete p.resources[r.id];await writeJSON(authStore,'auth',auth);audit(content,'permanently deleted','learning',r.title,user);await writeJSON(contentStore,'workspace',content);return json({ok:true,data:sanitizeWorkspace(content,auth,user)});
      } else return json({error:'Unknown resource action.'},400);
      await writeJSON(contentStore,'workspace',content);return json({ok:true,data:sanitizeWorkspace(content,auth,user),usage:using.map(c=>({id:c.id,title:c.title}))});
    }
    if(req.method==='POST'&&path==='learning/resource-open'){
      const b=await req.json();const r=content.resources.find(x=>x.id===b.resourceId);if(!r)return json({error:'Resource not found.'},404);
      const coursesUsing=content.courses.filter(c=>arr(c.modules).some(m=>m.resourceId===r.id));if(coursesUsing.length&&!isAdmin(user)&&!coursesUsing.some(c=>assignedCourse(c,user)))return json({error:'This resource is not assigned to you.'},403);
      auth=await loadAuth(authStore);const p=userProgress(auth,user.id);const rp=p.resources[r.id]||{firstOpenedAt:now(),opens:0};rp.lastOpenedAt=now();rp.opens=(rp.opens||0)+1;p.resources[r.id]=rp;await writeJSON(authStore,'auth',auth);
      const dataBase64=await fileStore.get(r.blobKey,{type:'text',consistency:'strong'});if(!dataBase64)return json({error:'File data is unavailable.'},404);return json({resource:{id:r.id,title:r.title,fileName:r.fileName,mimeType:r.mimeType,size:r.size},dataBase64,tracking:rp});
    }
    if(req.method==='POST'&&path==='learning/question'){
      needAdmin(user);const b=await req.json();if(b.action==='delete'){const q=content.questionBank.find(x=>x.id===b.id);content.questionBank=content.questionBank.filter(x=>x.id!==b.id);for(const quiz of content.quizzes)quiz.questionIds=arr(quiz.questionIds).filter(x=>x!==b.id);if(q)audit(content,'deleted','question bank',q.prompt,user);}
      else {const q={id:b.id||uid(),type:['single','multiple','truefalse'].includes(b.type)?b.type:'single',prompt:clean(b.prompt,2000),options:arr(b.options).map(x=>clean(x,500)).filter(Boolean),correct:arr(b.correct).map(Number),explanation:clean(b.explanation,3000),tags:arr(b.tags).map(x=>clean(x,100))};if(!q.prompt)return json({error:'Question text is required.'},400);const idx=content.questionBank.findIndex(x=>x.id===q.id);if(idx>=0)content.questionBank[idx]=q;else content.questionBank.unshift(q);audit(content,idx>=0?'updated':'created','question bank',q.prompt,user);}
      await writeJSON(contentStore,'workspace',content);return json({ok:true,questionBank:content.questionBank});
    }
    if(req.method==='POST'&&path==='learning/quiz'){
      needAdmin(user);const b=await req.json();if(b.action==='delete'){const q=content.quizzes.find(x=>x.id===b.id);content.quizzes=content.quizzes.filter(x=>x.id!==b.id);if(q)audit(content,'deleted','quizzes',q.title,user);}
      else {const q={id:b.id||uid(),title:clean(b.title,240),description:clean(b.description,1000),questionIds:arr(b.questionIds).filter(id=>content.questionBank.some(x=>x.id===id)),passMark:Math.max(0,Math.min(100,Number(b.passMark||80))),maxAttempts:Math.max(1,Math.min(20,Number(b.maxAttempts||3))),questionCount:Math.max(0,Number(b.questionCount||0)),shuffle:b.shuffle!==false,showFeedback:b.showFeedback!==false,createdAt:b.createdAt||now(),updatedAt:now()};if(!q.title)return json({error:'Quiz title is required.'},400);const idx=content.quizzes.findIndex(x=>x.id===q.id);if(idx>=0)content.quizzes[idx]=q;else content.quizzes.unshift(q);audit(content,idx>=0?'updated':'created','quizzes',q.title,user);}
      await writeJSON(contentStore,'workspace',content);return json({ok:true,quizzes:content.quizzes});
    }
    if(req.method==='POST'&&path==='learning/course'){
      needAdmin(user);const b=await req.json();if(b.action==='delete'){const c=content.courses.find(x=>x.id===b.id);if(c){c.status='Archived';c.updatedAt=now();audit(content,'archived','courses',c.title,user);}}
      else {const c={id:b.id||uid(),title:clean(b.title,240),description:clean(b.description,3000),coverUrl:clean(b.coverUrl,1500),status:b.status==='Draft'?'Draft':'Active',required:bool(b.required),dueDate:clean(b.dueDate,40),assignedGroupIds:arr(b.assignedGroupIds),assignedUserIds:arr(b.assignedUserIds),modules:arr(b.modules).map((m,i)=>({id:m.id||uid(),title:clean(m.title,240)||`Module ${i+1}`,type:['resource','quiz','text','link'].includes(m.type)?m.type:'text',resourceId:clean(m.resourceId,100),quizId:clean(m.quizId,100),text:clean(m.text,12000),link:clean(m.link,1500),required:m.required!==false})),createdAt:b.createdAt||now(),updatedAt:now(),createdBy:b.createdBy||user.id};if(!c.title)return json({error:'Course title is required.'},400);const idx=content.courses.findIndex(x=>x.id===c.id);if(idx>=0)content.courses[idx]=c;else content.courses.unshift(c);audit(content,idx>=0?'updated':'created','courses',c.title,user);}
      await writeJSON(contentStore,'workspace',content);return json({ok:true,data:sanitizeWorkspace(content,auth,user)});
    }
    if(req.method==='POST'&&path==='learning/module-complete'){
      const b=await req.json();const c=content.courses.find(x=>x.id===b.courseId);if(!c||(!isAdmin(user)&&!assignedCourse(c,user)))return json({error:'Course not found.'},404);const m=arr(c.modules).find(x=>x.id===b.moduleId);if(!m)return json({error:'Module not found.'},404);
      auth=await loadAuth(authStore);const p=userProgress(auth,user.id);p.modules[`${c.id}:${m.id}`]={completed:true,completedAt:now()};const cp=computeCourseProgress(c,p);p.courses[c.id]={...cp,updatedAt:now(),completedAt:cp.completed?(p.courses[c.id]?.completedAt||now()):null};await writeJSON(authStore,'auth',auth);return json({ok:true,progress:p,courseProgress:cp});
    }
    if(req.method==='POST'&&path==='learning/quiz-start'){
      const b=await req.json();const quiz=content.quizzes.find(x=>x.id===b.quizId);if(!quiz)return json({error:'Quiz not found.'},404);let questions=arr(quiz.questionIds).map(id=>content.questionBank.find(q=>q.id===id)).filter(Boolean);if(quiz.shuffle)questions=questions.sort(()=>Math.random()-.5);if(quiz.questionCount>0)questions=questions.slice(0,quiz.questionCount);
      auth=await loadAuth(authStore);const p=userProgress(auth,user.id);const attempts=arr(p.quizAttempts[quiz.id]);if(attempts.length>=quiz.maxAttempts)return json({error:'You have reached the maximum number of attempts.'},403);const qs=uid();auth.quizSessions[qs]={userId:user.id,quizId:quiz.id,questionIds:questions.map(q=>q.id),createdAt:now(),expiresAt:new Date(Date.now()+2*3600e3).toISOString()};await writeJSON(authStore,'auth',auth);return json({sessionId:qs,quiz:{id:quiz.id,title:quiz.title,description:quiz.description,passMark:quiz.passMark,maxAttempts:quiz.maxAttempts,questions:questions.map(sanitizeQuestion)}});
    }
    if(req.method==='POST'&&path==='learning/quiz-submit'){
      const b=await req.json();auth=await loadAuth(authStore);const s=auth.quizSessions[b.sessionId];if(!s||s.userId!==user.id)return json({error:'Quiz session expired or invalid.'},400);const quiz=content.quizzes.find(x=>x.id===s.quizId);if(!quiz)return json({error:'Quiz not found.'},404);let correctCount=0;const results=[];
      for(const qid of s.questionIds){const q=content.questionBank.find(x=>x.id===qid);if(!q)continue;const given=arr(b.answers?.[qid]).map(Number).sort((a,b)=>a-b), expected=arr(q.correct).map(Number).sort((a,b)=>a-b);const correct=given.length===expected.length&&given.every((v,i)=>v===expected[i]);if(correct)correctCount++;results.push({id:q.id,correct,explanation:quiz.showFeedback?q.explanation:'',correctAnswers:quiz.showFeedback?expected:undefined});}
      const score=s.questionIds.length?Math.round(correctCount/s.questionIds.length*100):0,passed=score>=quiz.passMark;const p=userProgress(auth,user.id);p.quizAttempts[quiz.id] ||= [];const attempt={id:uid(),at:now(),score,passed,questionCount:s.questionIds.length};p.quizAttempts[quiz.id].push(attempt);delete auth.quizSessions[b.sessionId];
      // complete course quiz modules on pass
      if(passed){for(const c of content.courses){for(const m of arr(c.modules)){if(m.type==='quiz'&&m.quizId===quiz.id){p.modules[`${c.id}:${m.id}`]={completed:true,completedAt:now()};const cp=computeCourseProgress(c,p);p.courses[c.id]={...cp,updatedAt:now(),completedAt:cp.completed?(p.courses[c.id]?.completedAt||now()):null};}}}}
      await writeJSON(authStore,'auth',auth);return json({score,passed,attempt,results,progress:p});
    }

    // ANALYTICS --------------------------------------------------------------
    if(req.method==='GET'&&path==='admin/analytics'){
      needAdmin(user);auth=await loadAuth(authStore);const users=auth.users.map(publicUser);const rows=[];
      for(const u of auth.users){const p=userProgress(auth,u.id);for(const c of content.courses){if(!assignedCourse(c,u))continue;const cp=computeCourseProgress(c,p);rows.push({userId:u.id,name:u.name,email:u.email,courseId:c.id,course:c.title,progress:cp.percent,completed:cp.completed,dueDate:c.dueDate||'',overdue:!!(c.dueDate&&!cp.completed&&new Date(c.dueDate)<new Date()),lastActivity:p.courses[c.id]?.updatedAt||''});}}
      const ackRows=[];for(const u of content.updates.filter(x=>x.mandatory)){for(const usr of auth.users.filter(x=>x.status==='active')){if(!targetMatches(u,usr))continue;const a=arr(u.acknowledgements).find(x=>x.userId===usr.id);ackRows.push({updateId:u.id,update:u.title,userId:usr.id,name:usr.name,email:usr.email,acknowledged:!!a,acknowledgedAt:a?.at||''});}}
      const quizRows=[];const resourceOpens=[];for(const u of auth.users){const p=userProgress(auth,u.id);for(const q of content.quizzes){for(const a of arr(p.quizAttempts[q.id]))quizRows.push({name:u.name,email:u.email,quiz:q.title,score:a.score,passed:a.passed,attemptedAt:a.at});}for(const [rid,rp] of Object.entries(p.resources||{})){const r=content.resources.find(x=>x.id===rid);if(r)resourceOpens.push({name:u.name,email:u.email,resource:r.title,fileName:r.fileName,firstOpenedAt:rp.firstOpenedAt||'',lastOpenedAt:rp.lastOpenedAt||'',opens:rp.opens||0});}}
      return json({users,learning:rows,acknowledgements:ackRows,quizAttempts:quizRows,resourceOpens,activity:content.activity.slice(0,1000)});
    }

    return json({error:'Not found.'},404);
  }catch(err){console.error(err);return json({error:err?.message||'Server error.'},err?.status||500)}
};
