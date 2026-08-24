import { arr, assignedCourse, canEdit, computeCourseProgress, isAdmin, publicUser, targetMatches, visibleItem, now, uid, clean } from './domain.mjs';
import { mutateCollection, readCollections, readProgress } from './store.mjs';

export async function recordAudit(action, collection, label, user, detail = '') {
  await mutateCollection('activity', activity => {
    activity.unshift({
      id: uid(),
      at: now(),
      action,
      collection,
      label: clean(label, 300) || 'Untitled',
      actor: user?.name || 'System',
      actorId: user?.id || null,
      detail: clean(detail, 800),
    });
    if (activity.length > 5000) activity.length = 5000;
  });
}

export async function notificationList(content, auth, user, progress) {
  const items = [];
  const seen = progress.notificationReads || {};
  const updates = arr(content.updates).filter(item => visibleItem(item, user) && targetMatches(item, user));
  const docs = arr(content.docs).filter(item => visibleItem(item, user) && targetMatches(item, user));
  const courses = arr(content.courses).filter(item => isAdmin(user) || assignedCourse(item, user));

  for (const update of updates.filter(item => item.status === 'Active')) {
    const read = arr(update.acknowledgements).some(ack => ack.userId === user.id || (!ack.userId && ack.name === user.name));
    if (update.mandatory && !read) {
      items.push({ id: `update:${update.id}`, type: 'mandatory', title: 'Acknowledgement required', text: update.title, view: 'communications', itemId: update.id, priority: update.priority || 'High' });
    }
  }

  const reviewCutoff = new Date(Date.now() + 14 * 864e5);
  if (canEdit(user)) {
    for (const doc of docs) {
      if (doc.reviewDate && new Date(doc.reviewDate) < reviewCutoff) {
        items.push({ id: `doc:${doc.id}:${doc.reviewDate}`, type: 'review', title: 'Knowledge review due', text: doc.title, view: 'knowledge', itemId: doc.id, priority: new Date(doc.reviewDate) < new Date() ? 'High' : 'Normal' });
      }
    }
    for (const update of updates) {
      if (update.reviewDate && new Date(update.reviewDate) < reviewCutoff) {
        items.push({ id: `review:${update.id}:${update.reviewDate}`, type: 'review', title: 'Communication review due', text: update.title, view: 'communications', itemId: update.id, priority: new Date(update.reviewDate) < new Date() ? 'High' : 'Normal' });
      }
    }
  }

  for (const course of courses) {
    const courseProgress = computeCourseProgress(course, progress);
    if (courseProgress.completed) continue;
    if (course.dueDate && new Date(course.dueDate) < new Date()) {
      items.push({ id: `course:${course.id}:${course.dueDate}`, type: 'overdue', title: 'Learning overdue', text: course.title, view: 'learning', itemId: course.id, priority: 'High' });
    } else {
      items.push({ id: `course:${course.id}:${course.dueDate || 'assigned'}`, type: 'learning', title: 'Learning assigned', text: course.title, view: 'learning', itemId: course.id, priority: 'Normal' });
    }
  }

  const incidents = arr(content.incidents).filter(item => item.status !== 'Resolved' && item.status !== 'Archived');
  for (const incident of incidents) {
    if (['Critical', 'High'].includes(incident.severity)) {
      items.push({ id: `incident:${incident.id}:${incident.updatedAt || incident.createdAt}`, type: 'incident', title: `${incident.severity} incident`, text: incident.title, view: 'operations', itemId: incident.id, priority: incident.severity });
    }
  }

  if (isAdmin(user)) {
    const approvalItems = [...arr(content.updates), ...arr(content.docs), ...arr(content.decisions)].filter(item => item.approvalStatus === 'pending');
    if (approvalItems.length) {
      items.push({ id: `approvals:${approvalItems.length}:${approvalItems.map(item => item.updatedAt || item.createdAt || '').sort().at(-1) || ''}`, type: 'admin', title: 'Content awaiting approval', text: `${approvalItems.length} item${approvalItems.length === 1 ? '' : 's'} need review.`, view: 'admin', priority: 'High' });
    }
    const pendingUsers = arr(auth.users).filter(item => item.status === 'pending' || item.status === 'invited');
    if (pendingUsers.length) {
      items.push({ id: `users:${pendingUsers.length}:${pendingUsers.map(item => item.createdAt || '').sort().at(-1) || ''}`, type: 'admin', title: 'Account approvals', text: `${pendingUsers.length} account${pendingUsers.length === 1 ? '' : 's'} waiting.`, view: 'admin', priority: 'Normal' });
    }
  }

  return items.filter(item => !seen[item.id]);
}

function sanitizedResource(resource) {
  return {
    id: resource.id,
    title: resource.title,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    size: resource.size,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt || resource.createdAt,
    uploadedBy: resource.uploadedBy,
    status: resource.status || 'Active',
    description: resource.description || '',
    category: resource.category || 'General',
    version: resource.version || 1,
    reviewDate: resource.reviewDate || '',
  };
}

export async function sanitizeWorkspace(content, auth, user, progress, scopes = null) {
  const requested = new Set(scopes || ['updates','docs','decisions','groups','courses','resources','quizzes','questionBank','activity','incidents','handoffs','roster','attachments','notifications','progress','me']);
  const output = {};
  if (requested.has('updates')) output.updates = arr(content.updates).filter(item => visibleItem(item, user) && targetMatches(item, user));
  if (requested.has('docs')) output.docs = arr(content.docs).filter(item => visibleItem(item, user) && targetMatches(item, user));
  if (requested.has('decisions')) output.decisions = arr(content.decisions).filter(item => visibleItem(item, user) && targetMatches(item, user));
  if (requested.has('groups')) output.groups = arr(content.groups);
  if (requested.has('courses')) output.courses = arr(content.courses).filter(item => isAdmin(user) || assignedCourse(item, user)).map(course => ({ ...course, progress: computeCourseProgress(course, progress) }));
  if (requested.has('resources')) {
    if (isAdmin(user)) output.resources = arr(content.resources).map(sanitizedResource);
    else {
      const allowed = new Set(arr(content.courses).filter(course => assignedCourse(course,user)).flatMap(course => arr(course.modules).filter(module => module.type === 'resource').map(module => module.resourceId)));
      output.resources = arr(content.resources).filter(resource => allowed.has(resource.id)).map(sanitizedResource);
    }
  }
  if (requested.has('attachments')) {
    let allowedIds = null;
    if (!canEdit(user)) {
      allowedIds = new Set([...arr(content.updates),...arr(content.docs)].filter(item => visibleItem(item,user) && targetMatches(item,user)).flatMap(item => arr(item.attachmentIds)));
    }
    output.attachments = arr(content.attachments).filter(item => !allowedIds || allowedIds.has(item.id)).map(item => ({ id:item.id,fileName:item.fileName,mimeType:item.mimeType,size:item.size,title:item.title,createdAt:item.createdAt,uploadedBy:item.uploadedBy,status:item.status || 'Active' }));
  }
  if (requested.has('quizzes')) output.quizzes = isAdmin(user) ? arr(content.quizzes) : [];
  if (requested.has('questionBank')) output.questionBank = isAdmin(user) ? arr(content.questionBank) : [];
  if (requested.has('activity')) output.activity = isAdmin(user) ? arr(content.activity).slice(0, 1000) : [];
  if (requested.has('incidents')) output.incidents = arr(content.incidents).filter(item => item.status !== 'Archived' || canEdit(user));
  if (requested.has('handoffs')) output.handoffs = arr(content.handoffs).filter(item => item.status !== 'Archived' || canEdit(user));
  if (requested.has('roster')) output.roster = arr(content.roster).filter(item => item.status !== 'Archived' || canEdit(user));
  if (requested.has('progress')) output.progress = progress;
  if (requested.has('me')) output.me = publicUser(user);
  if (requested.has('notifications')) output.notifications = await notificationList(content, auth, user, progress);
  return output;
}

export async function loadWorkspace(names) {
  return readCollections(names);
}

export async function getUserWorkspace(auth, user, scopes = null) {
  const names = scopes?.filter(name => !['notifications','progress','me'].includes(name)) || undefined;
  const content = await readCollections(names);
  const progress = await readProgress(user.id);
  return sanitizeWorkspace(content, auth, user, progress, scopes);
}
