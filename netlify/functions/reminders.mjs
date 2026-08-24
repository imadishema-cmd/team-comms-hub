import { arr, assignedCourse, targetMatches } from './lib/domain.mjs';
import { readAuth, readCollections, readProgress, reminderStore } from './lib/store.mjs';
import { sendEmail, sendSlack } from './lib/notify.mjs';

const hours = value => Number(value) * 3600e3;

async function once(key) {
  const result = await reminderStore().setJSON(key, { sentAt: new Date().toISOString() }, { onlyIfNew: true });
  return result.modified;
}

export default async function reminderJob() {
  const auth = await readAuth();
  const content = await readCollections(['updates','courses']);
  const activeUsers = auth.users.filter(user => user.status === 'active');
  const ackDelay = Math.max(1, Number(process.env.ACK_REMINDER_HOURS || 2));
  const now = Date.now();
  const tasks = [];
  let sent = 0;

  for (const update of content.updates.filter(item => item.status === 'Active' && item.approvalStatus === 'approved' && item.mandatory && ['Critical','High'].includes(item.priority))) {
    if (now - new Date(update.createdAt || update.updatedAt || now).getTime() < hours(ackDelay)) continue;
    for (const user of activeUsers.filter(target => targetMatches(update, target))) {
      if (arr(update.acknowledgements).some(ack => ack.userId === user.id)) continue;
      const bucket = new Date().toISOString().slice(0,13);
      if (!await once(`ack:${update.id}:${user.id}:${bucket}`)) continue;
      sent += 1;
      tasks.push(sendEmail({
        to:user.email,
        subject:`Reminder: acknowledgement required — ${update.title}`,
        text:`Please open the Centralized Call Center Hub and acknowledge: ${update.title}`,
        html:`<p>Please open the Centralized Call Center Hub and acknowledge:</p><p><strong>${update.title}</strong></p>`,
      }));
    }
  }

  for (const course of content.courses.filter(item => item.status === 'Active' && item.dueDate && new Date(item.dueDate) < new Date())) {
    for (const user of activeUsers.filter(target => assignedCourse(course,target))) {
      const progress = await readProgress(user.id);
      const modules = arr(course.modules);
      const completed = modules.length && modules.every(module => progress.modules?.[`${course.id}:${module.id}`]?.completed);
      if (completed) continue;
      const bucket = new Date().toISOString().slice(0,10);
      if (!await once(`course:${course.id}:${user.id}:${bucket}`)) continue;
      sent += 1;
      tasks.push(sendEmail({
        to:user.email,
        subject:`Overdue learning: ${course.title}`,
        text:`Your assigned learning is overdue: ${course.title}. Open the Centralized Call Center Hub to continue.`,
        html:`<p>Your assigned learning is overdue:</p><p><strong>${course.title}</strong></p><p>Open the Centralized Call Center Hub to continue.</p>`,
      }));
    }
  }

  const supervisorEmails = String(process.env.SUPERVISOR_EMAILS || '').split(',').map(item=>item.trim()).filter(Boolean);
  if (sent > 0) {
    tasks.push(sendSlack(`Call Center Hub reminder job sent ${sent} acknowledgement/learning reminder${sent===1?'':'s'}.`));
    if (supervisorEmails.length) tasks.push(sendEmail({to:supervisorEmails,subject:'Call Center Hub reminder summary',text:`${sent} reminder${sent===1?'':'s'} sent in this run.`,html:`<p>${sent} reminder${sent===1?'':'s'} sent in this run.</p>`}));
  }
  await Promise.allSettled(tasks);
  console.log(`Reminder job complete. Sent ${sent}.`);
}

export const config = { schedule: '@hourly' };
