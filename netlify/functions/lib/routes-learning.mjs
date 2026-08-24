import {
  arr,
  assignedCourse,
  bool,
  clean,
  computeCourseProgress,
  isAdmin,
  now,
  sanitizeQuestion,
  uid,
  validateUploadedFile,
} from './domain.mjs';
import {
  fileStore,
  mutateAuth,
  mutateCollection,
  mutateProgress,
  oldFileStore,
  readAuth,
  readCollection,
  readProgress,
} from './store.mjs';
import { authenticate, json, needAdmin, needUser } from './security.mjs';
import { recordAudit } from './workspace.mjs';

export async function handleLearning(req, path, url) {
  if (!path.startsWith('learning/')) return null;
  const { user } = await authenticate(req, { requireCsrf: !['GET','HEAD','OPTIONS'].includes(req.method) });
  needUser(user);

  if (req.method === 'POST' && path === 'learning/resource-upload') {
    needAdmin(user);
    const body = await req.json();
    const file = validateUploadedFile(body);
    const resources = await readCollection('resources');
    const existing = body.id ? resources.find(item => item.id === body.id) : null;
    const arrayBuffer = file.buffer.buffer.slice(file.buffer.byteOffset,file.buffer.byteOffset+file.buffer.byteLength);

    if (existing) {
      const store = existing.fileStoreVersion === 'v3' ? oldFileStore() : fileStore();
      if (existing.fileStoreVersion === 'v3') {
        // Replacements move legacy files into the V4 binary store.
        existing.blobKey = `resource-${existing.id}`;
        existing.fileStoreVersion = 'v4';
      }
      await fileStore().set(existing.blobKey,arrayBuffer,{metadata:{mimeType:file.mimeType,fileName:file.fileName,inline:file.inline}});
      let saved;
      await mutateCollection('resources', items => {
        const target = items.find(item => item.id === existing.id);
        if (!target) throw Object.assign(new Error('Resource not found.'),{status:404});
        Object.assign(target,{
          fileName:file.fileName,mimeType:file.mimeType,size:file.size,inline:file.inline,
          title:clean(body.title || file.fileName,240),description:clean(body.description,2000),category:clean(body.category,120)||'General',
          reviewDate:clean(body.reviewDate,40),version:Math.max(1,Number(target.version||1))+1,status:'Active',updatedAt:now(),
          blobKey:existing.blobKey,fileStoreVersion:'v4',
        });
        saved=target;
      });
      await recordAudit('replaced file','learning',saved.title,user,`Version ${saved.version}`);
      return json({resource:{...saved,blobKey:undefined}},200);
    }

    const id=uid();const blobKey=`resource-${id}`;
    await fileStore().set(blobKey,arrayBuffer,{metadata:{mimeType:file.mimeType,fileName:file.fileName,inline:file.inline}});
    let resource;
    await mutateCollection('resources',items=>{
      resource={id,title:clean(body.title||file.fileName,240),fileName:file.fileName,mimeType:file.mimeType,size:file.size,inline:file.inline,blobKey,fileStoreVersion:'v4',uploadedBy:user.name,uploadedById:user.id,createdAt:now(),updatedAt:now(),status:'Active',description:clean(body.description,2000),category:clean(body.category,120)||'General',version:1,reviewDate:clean(body.reviewDate,40)};
      items.unshift(resource);
    });
    await recordAudit('uploaded','learning',resource.title,user);
    return json({resource:{...resource,blobKey:undefined}},201);
  }

  if(req.method==='POST'&&path==='learning/resource-manage'){
    needAdmin(user);const body=await req.json();const courses=await readCollection('courses');const using=courses.filter(course=>arr(course.modules).some(module=>module.type==='resource'&&module.resourceId===body.id));let changed;let deleted=false;
    await mutateCollection('resources',items=>{const index=items.findIndex(item=>item.id===body.id);if(index<0)throw Object.assign(new Error('Resource not found.'),{status:404});const resource=items[index];
      if(body.action==='update'){resource.title=clean(body.title,240)||resource.title;resource.description=clean(body.description,2000);resource.category=clean(body.category,120)||'General';resource.reviewDate=clean(body.reviewDate,40);resource.updatedAt=now();changed=resource;}
      else if(body.action==='archive'){resource.status='Archived';resource.updatedAt=now();changed=resource;}
      else if(body.action==='restore'){resource.status='Active';resource.updatedAt=now();changed=resource;}
      else if(body.action==='delete'){if(using.length)throw Object.assign(new Error(`This document is used in ${using.length} course${using.length===1?'':'s'}. Remove or replace it first.`),{status:409});changed=resource;items.splice(index,1);deleted=true;}
      else throw Object.assign(new Error('Unknown resource action.'),{status:400});
    });
    if(deleted&&changed.blobKey){const store=changed.fileStoreVersion==='v3'?oldFileStore():fileStore();await store.delete(changed.blobKey);}
    await recordAudit(deleted?'permanently deleted':body.action,'learning',changed.title,user,using.length?`${using.length} course(s) reference this resource`: '');
    return json({ok:true,resource:deleted?null:{...changed,blobKey:undefined},usage:using.map(course=>({id:course.id,title:course.title}))});
  }

  if(req.method==='POST'&&path==='learning/resource-open'){
    const body=await req.json();const resources=await readCollection('resources');const resource=resources.find(item=>item.id===body.resourceId);if(!resource)return json({error:'Resource not found.'},404);
    const courses=await readCollection('courses');const usedBy=courses.filter(course=>arr(course.modules).some(module=>module.resourceId===resource.id));if(!isAdmin(user)&&(!usedBy.length||!usedBy.some(course=>assignedCourse(course,user))))return json({error:'This resource is not assigned to you.'},403);
    let tracking;await mutateProgress(user.id,progress=>{const current=progress.resources[resource.id]||{firstOpenedAt:now(),opens:0};current.lastOpenedAt=now();current.opens=Number(current.opens||0)+1;progress.resources[resource.id]=current;tracking=current;});
    return json({resource:{id:resource.id,title:resource.title,fileName:resource.fileName,mimeType:resource.mimeType,size:resource.size},tracking,url:`/api/learning/resource-file?id=${encodeURIComponent(resource.id)}`});
  }

  if(req.method==='GET'&&path==='learning/resource-file'){
    const id=clean(url.searchParams.get('id'),100);const resources=await readCollection('resources');const resource=resources.find(item=>item.id===id);if(!resource)return json({error:'Resource not found.'},404);
    const courses=await readCollection('courses');const usedBy=courses.filter(course=>arr(course.modules).some(module=>module.resourceId===resource.id));if(!isAdmin(user)&&(!usedBy.length||!usedBy.some(course=>assignedCourse(course,user))))return json({error:'This resource is not assigned to you.'},403);
    const store=resource.fileStoreVersion==='v3'?oldFileStore():fileStore();let data;
    if(resource.fileStoreVersion==='v3'){const base64=await store.get(resource.blobKey,{type:'text',consistency:'strong'});if(base64)data=Buffer.from(base64,'base64');}
    else{const buffer=await store.get(resource.blobKey,{type:'arrayBuffer',consistency:'strong'});if(buffer)data=Buffer.from(buffer);}
    if(!data)return json({error:'File data is unavailable.'},404);
    const inline=resource.inline!==false && /^(application\/pdf|image\/|text\/|video\/mp4)/.test(resource.mimeType||'');
    return new Response(data,{status:200,headers:{'content-type':resource.mimeType||'application/octet-stream','content-disposition':`${inline?'inline':'attachment'}; filename="${String(resource.fileName||'file').replace(/"/g,'')}"`,'cache-control':'private,max-age=60','x-content-type-options':'nosniff'}});
  }

  if(req.method==='POST'&&path==='learning/question'){
    needAdmin(user);const body=await req.json();let bank;
    const out=await mutateCollection('questionBank',items=>{if(body.action==='delete'){const index=items.findIndex(item=>item.id===body.id);if(index<0)throw Object.assign(new Error('Question not found.'),{status:404});const [q]=items.splice(index,1);return {result:{deleted:q}};}
      const q={id:body.id||uid(),type:['single','multiple','truefalse'].includes(body.type)?body.type:'single',prompt:clean(body.prompt,2000),options:arr(body.options).map(item=>clean(item,500)).filter(Boolean),correct:arr(body.correct).map(Number),explanation:clean(body.explanation,3000),tags:arr(body.tags).map(item=>clean(item,100))};if(!q.prompt)throw Object.assign(new Error('Question text is required.'),{status:400});const index=items.findIndex(item=>item.id===q.id);if(index>=0)items[index]=q;else items.unshift(q);return {result:{question:q,updated:index>=0}};});
    bank=out.value;const result=out.result;if(result.deleted){await mutateCollection('quizzes',quizzes=>{for(const quiz of quizzes)quiz.questionIds=arr(quiz.questionIds).filter(id=>id!==body.id);});await recordAudit('deleted','question bank',result.deleted.prompt,user);}else await recordAudit(result.updated?'updated':'created','question bank',result.question.prompt,user);
    return json({ok:true,questionBank:bank});
  }

  if(req.method==='POST'&&path==='learning/quiz'){
    needAdmin(user);const body=await req.json();const questionBank=await readCollection('questionBank');let saved;let deleted;
    await mutateCollection('quizzes',quizzes=>{if(body.action==='delete'){const index=quizzes.findIndex(item=>item.id===body.id);if(index>=0)[deleted]=quizzes.splice(index,1);return;}
      const quiz={id:body.id||uid(),title:clean(body.title,240),description:clean(body.description,1000),questionIds:arr(body.questionIds).filter(id=>questionBank.some(item=>item.id===id)),passMark:Math.max(0,Math.min(100,Number(body.passMark||80))),maxAttempts:Math.max(1,Math.min(20,Number(body.maxAttempts||3))),questionCount:Math.max(0,Number(body.questionCount||0)),shuffle:body.shuffle!==false,showFeedback:body.showFeedback!==false,createdAt:body.createdAt||now(),updatedAt:now()};if(!quiz.title)throw Object.assign(new Error('Quiz title is required.'),{status:400});const index=quizzes.findIndex(item=>item.id===quiz.id);if(index>=0)quizzes[index]=quiz;else quizzes.unshift(quiz);saved=quiz;});
    await recordAudit(deleted?'deleted':body.id?'updated':'created','quizzes',(deleted||saved)?.title||'Quiz',user);return json({ok:true,quiz:saved||null,deletedId:deleted?.id||null});
  }

  if(req.method==='POST'&&path==='learning/course'){
    needAdmin(user);const body=await req.json();let saved;
    await mutateCollection('courses',courses=>{if(body.action==='delete'){const course=courses.find(item=>item.id===body.id);if(!course)throw Object.assign(new Error('Course not found.'),{status:404});course.status='Archived';course.updatedAt=now();saved=course;return;}
      const course={id:body.id||uid(),title:clean(body.title,240),description:clean(body.description,3000),coverUrl:clean(body.coverUrl,1500),status:['Draft','Active','Archived'].includes(body.status)?body.status:'Active',required:bool(body.required),dueDate:clean(body.dueDate,40),assignedGroupIds:arr(body.assignedGroupIds),assignedUserIds:arr(body.assignedUserIds),modules:arr(body.modules).map((module,index)=>({id:module.id||uid(),title:clean(module.title,240)||`Module ${index+1}`,type:['resource','quiz','text','link'].includes(module.type)?module.type:'text',resourceId:clean(module.resourceId,100),quizId:clean(module.quizId,100),text:clean(module.text,16000),link:clean(module.link,1500),required:module.required!==false})),createdAt:body.createdAt||now(),updatedAt:now(),createdBy:body.createdBy||user.id};if(!course.title)throw Object.assign(new Error('Course title is required.'),{status:400});const index=courses.findIndex(item=>item.id===course.id);if(index>=0)courses[index]=course;else courses.unshift(course);saved=course;});
    await recordAudit(body.action==='delete'?'archived':body.id?'updated':'created','courses',saved.title,user);return json({ok:true,course:saved});
  }

  if(req.method==='POST'&&path==='learning/module-complete'){
    const body=await req.json();const courses=await readCollection('courses');const course=courses.find(item=>item.id===body.courseId);if(!course||(!isAdmin(user)&&!assignedCourse(course,user)))return json({error:'Course not found.'},404);const module=arr(course.modules).find(item=>item.id===body.moduleId);if(!module)return json({error:'Module not found.'},404);let courseProgress;
    const {progress}=await mutateProgress(user.id,state=>{state.modules[`${course.id}:${module.id}`]={completed:true,completedAt:now()};courseProgress=computeCourseProgress(course,state);state.courses[course.id]={...courseProgress,updatedAt:now(),completedAt:courseProgress.completed?(state.courses[course.id]?.completedAt||now()):null};});
    return json({ok:true,progress,courseProgress});
  }

  if(req.method==='POST'&&path==='learning/quiz-start'){
    const body=await req.json();const [quizzes,questionBank]=await Promise.all([readCollection('quizzes'),readCollection('questionBank')]);const quiz=quizzes.find(item=>item.id===body.quizId);if(!quiz)return json({error:'Quiz not found.'},404);const progress=await readProgress(user.id);const attempts=arr(progress.quizAttempts[quiz.id]);if(attempts.length>=quiz.maxAttempts)return json({error:'You have reached the maximum number of attempts.'},403);let questions=arr(quiz.questionIds).map(id=>questionBank.find(question=>question.id===id)).filter(Boolean);if(quiz.shuffle)questions=questions.sort(()=>Math.random()-.5);if(quiz.questionCount>0)questions=questions.slice(0,quiz.questionCount);const sessionId=uid();await mutateAuth(auth=>{auth.quizSessions[sessionId]={userId:user.id,quizId:quiz.id,questionIds:questions.map(question=>question.id),createdAt:now(),expiresAt:new Date(Date.now()+2*3600e3).toISOString()};});
    return json({sessionId,quiz:{id:quiz.id,title:quiz.title,description:quiz.description,passMark:quiz.passMark,maxAttempts:quiz.maxAttempts,questions:questions.map(sanitizeQuestion)}});
  }

  if(req.method==='POST'&&path==='learning/quiz-submit'){
    const body=await req.json();const [quizzes,questionBank,courses]=await Promise.all([readCollection('quizzes'),readCollection('questionBank'),readCollection('courses')]);let quizSession;await mutateAuth(auth=>{quizSession=auth.quizSessions[body.sessionId];if(!quizSession||quizSession.userId!==user.id)throw Object.assign(new Error('Quiz session expired or invalid.'),{status:400});delete auth.quizSessions[body.sessionId];});const quiz=quizzes.find(item=>item.id===quizSession.quizId);if(!quiz)return json({error:'Quiz not found.'},404);let correctCount=0;const results=[];for(const questionId of quizSession.questionIds){const question=questionBank.find(item=>item.id===questionId);if(!question)continue;const given=arr(body.answers?.[questionId]).map(Number).sort((a,b)=>a-b),expected=arr(question.correct).map(Number).sort((a,b)=>a-b);const correct=given.length===expected.length&&given.every((value,index)=>value===expected[index]);if(correct)correctCount++;results.push({id:question.id,correct,explanation:quiz.showFeedback?question.explanation:'',correctAnswers:quiz.showFeedback?expected:undefined});}const score=quizSession.questionIds.length?Math.round(correctCount/quizSession.questionIds.length*100):0,passed=score>=quiz.passMark;const attempt={id:uid(),at:now(),score,passed,questionCount:quizSession.questionIds.length};let progress;
    ({progress}=await mutateProgress(user.id,state=>{state.quizAttempts[quiz.id] ||= [];state.quizAttempts[quiz.id].push(attempt);if(passed){for(const course of courses){for(const module of arr(course.modules)){if(module.type==='quiz'&&module.quizId===quiz.id){state.modules[`${course.id}:${module.id}`]={completed:true,completedAt:now()};const courseProgress=computeCourseProgress(course,state);state.courses[course.id]={...courseProgress,updatedAt:now(),completedAt:courseProgress.completed?(state.courses[course.id]?.completedAt||now()):null};}}}}}));
    return json({score,passed,attempt,results,progress});
  }

  return null;
}
