import {
  arr,
  assignedCourse,
  clean,
  computeCourseProgress,
  hashPassword,
  now,
  publicUser,
  uid,
  validatePassword,
  allowedEmail,
  targetMatches,
} from './domain.mjs';
import {
  mutateAuth,
  mutateCollection,
  readAuth,
  readCollection,
  readCollections,
  readProgress,
} from './store.mjs';
import { authenticate, json, needAdmin } from './security.mjs';
import { recordAudit } from './workspace.mjs';

export async function handleAdmin(req, path) {
  if (!path.startsWith('admin/')) return null;
  const { user } = await authenticate(req, { requireCsrf: !['GET','HEAD','OPTIONS'].includes(req.method) });
  needAdmin(user);

  if (req.method === 'GET' && path === 'admin/users') {
    const auth = await readAuth();
    return json({
      users: auth.users.map(publicUser),
      resetRequests: arr(auth.passwordResetRequests),
      invites: arr(auth.invites),
    });
  }

  if (req.method === 'POST' && path === 'admin/user') {
    const body = await req.json();
    let changed;
    await mutateAuth(auth => {
      const target = auth.users.find(item => item.id === body.userId);
      if (!target) throw Object.assign(new Error('User not found.'), { status:404 });
      if (body.action === 'role') {
        if (!['viewer','editor','admin'].includes(body.role)) throw Object.assign(new Error('Invalid role.'),{status:400});
        if (target.id === user.id && body.role !== 'admin' && auth.users.filter(item => item.role === 'admin' && item.status === 'active').length <= 1) throw Object.assign(new Error('At least one active Admin must remain.'),{status:400});
        target.role = body.role;
      } else if (body.action === 'status') {
        if (!['active','pending','suspended','invited'].includes(body.status)) throw Object.assign(new Error('Invalid status.'),{status:400});
        if (target.id === user.id && body.status !== 'active') throw Object.assign(new Error('You cannot suspend your own account.'),{status:400});
        target.status = body.status;
      } else if (body.action === 'groups') {
        target.groupIds = arr(body.groupIds);
      } else if (body.action === 'verify-email') {
        target.emailVerifiedAt = now();
      } else if (body.action === 'reset-password') {
        const password = String(body.password || '');
        if (!validatePassword(password)) throw Object.assign(new Error('Temporary password must be at least 10 characters and include a letter and number.'),{status:400});
        target.passwordHash = hashPassword(password);
        for (const [sessionHash, session] of Object.entries(auth.sessions)) if (session.userId === target.id) delete auth.sessions[sessionHash];
        for (const request of auth.passwordResetRequests) if (request.userId === target.id && request.status === 'open') { request.status='resolved'; request.resolvedAt=now(); }
      } else {
        throw Object.assign(new Error('Unknown action.'),{status:400});
      }
      changed = target;
    });
    await recordAudit(`user ${body.action}`,'users',changed.email,user,body.role || body.status || '');
    return json({ok:true,user:publicUser(changed)});
  }

  if (req.method === 'POST' && path === 'admin/users/import') {
    const body = await req.json();
    const rows = arr(body.users).slice(0,500);
    let created = 0, skipped = 0;
    await mutateAuth(auth => {
      for (const row of rows) {
        const email = clean(row.email,240).toLowerCase();
        if (!email.includes('@') || !allowedEmail(email) || auth.users.some(item => item.email === email)) { skipped += 1; continue; }
        const role = ['viewer','editor'].includes(row.role) ? row.role : 'viewer';
        auth.users.push({
          id:uid(),
          name:clean(row.name,120) || email.split('@')[0],
          email,
          passwordHash:'',
          role,
          status:'invited',
          groupIds:arr(row.groupIds),
          emailVerifiedAt:null,
          mfa:{enabled:false},
          invitedAt:now(),
          createdAt:now(),
          lastLoginAt:null,
        });
        created += 1;
      }
    });
    await recordAudit('bulk imported','users',`${created} invited users`,user,`${skipped} skipped`);
    return json({ok:true,created,skipped});
  }

  if (req.method === 'POST' && path === 'admin/users/bulk') {
    const body = await req.json();
    const ids = new Set(arr(body.userIds));
    let count=0;
    await mutateAuth(auth => {
      for (const target of auth.users) {
        if (!ids.has(target.id)) continue;
        if (body.action === 'role' && ['viewer','editor','admin'].includes(body.role)) { target.role=body.role; count++; }
        else if (body.action === 'status' && ['active','pending','suspended'].includes(body.status) && target.id!==user.id) { target.status=body.status; count++; }
        else if (body.action === 'groups') { target.groupIds=arr(body.groupIds); count++; }
      }
      if (!auth.users.some(item=>item.role==='admin'&&item.status==='active')) throw Object.assign(new Error('At least one active Admin must remain.'),{status:400});
    });
    await recordAudit(`bulk user ${body.action}`,'users',`${count} users`,user);
    return json({ok:true,count});
  }

  if (req.method === 'POST' && path === 'admin/group') {
    const body=await req.json(); let changed;
    if(body.action==='create'){
      await mutateCollection('groups',groups=>{changed={id:uid(),name:clean(body.name,120),description:clean(body.description,500),createdAt:now()};if(!changed.name)throw Object.assign(new Error('Group name is required.'),{status:400});groups.push(changed);});
      await recordAudit('created','groups',changed.name,user);
    } else if(body.action==='update'){
      await mutateCollection('groups',groups=>{const group=groups.find(item=>item.id===body.id);if(!group)throw Object.assign(new Error('Group not found.'),{status:404});group.name=clean(body.name,120)||group.name;group.description=clean(body.description,500);group.updatedAt=now();changed=group;});
      await recordAudit('updated','groups',changed.name,user);
    } else if(body.action==='delete'){
      await mutateCollection('groups',groups=>{const index=groups.findIndex(item=>item.id===body.id);if(index<0)throw Object.assign(new Error('Group not found.'),{status:404});[changed]=groups.splice(index,1);});
      await mutateAuth(auth=>{for(const target of auth.users)target.groupIds=arr(target.groupIds).filter(id=>id!==body.id);});
      for (const collection of ['updates','docs','decisions']) await mutateCollection(collection,items=>{for(const item of items)item.targetGroupIds=arr(item.targetGroupIds).filter(id=>id!==body.id);});
      await mutateCollection('courses',items=>{for(const item of items)item.assignedGroupIds=arr(item.assignedGroupIds).filter(id=>id!==body.id);});
      await recordAudit('deleted','groups',changed.name,user);
    } else return json({error:'Unknown action.'},400);
    return json({ok:true,group:changed});
  }

  if(req.method==='GET'&&path==='admin/analytics'){
    const auth=await readAuth();
    const content=await readCollections(['courses','updates','quizzes','resources','activity','incidents']);
    const learning=[];const acknowledgements=[];const quizAttempts=[];const resourceOpens=[];
    for(const target of auth.users){
      const progress=await readProgress(target.id);
      for(const course of content.courses){if(!assignedCourse(course,target))continue;const cp=computeCourseProgress(course,progress);learning.push({userId:target.id,name:target.name,email:target.email,courseId:course.id,course:course.title,progress:cp.percent,completed:cp.completed,dueDate:course.dueDate||'',overdue:Boolean(course.dueDate&&!cp.completed&&new Date(course.dueDate)<new Date()),lastActivity:progress.courses[course.id]?.updatedAt||''});}
      for(const quiz of content.quizzes){for(const attempt of arr(progress.quizAttempts[quiz.id]))quizAttempts.push({name:target.name,email:target.email,quiz:quiz.title,score:attempt.score,passed:attempt.passed,attemptedAt:attempt.at});}
      for(const [resourceId,tracking] of Object.entries(progress.resources||{})){const resource=content.resources.find(item=>item.id===resourceId);if(resource)resourceOpens.push({name:target.name,email:target.email,resource:resource.title,fileName:resource.fileName,firstOpenedAt:tracking.firstOpenedAt||'',lastOpenedAt:tracking.lastOpenedAt||'',opens:tracking.opens||0});}
    }
    for(const update of content.updates.filter(item=>item.mandatory)){for(const target of auth.users.filter(item=>item.status==='active'&&targetMatches(update,item))){const ack=arr(update.acknowledgements).find(item=>item.userId===target.id);acknowledgements.push({updateId:update.id,update:update.title,userId:target.id,name:target.name,email:target.email,acknowledged:Boolean(ack),acknowledgedAt:ack?.at||''});}}
    return json({users:auth.users.map(publicUser),learning,acknowledgements,quizAttempts,resourceOpens,activity:content.activity.slice(0,1500),incidents:content.incidents});
  }

  return null;
}
