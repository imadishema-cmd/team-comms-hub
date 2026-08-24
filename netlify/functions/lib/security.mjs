import { getStore } from '@netlify/blobs';
import { arr, now } from './domain.mjs';

export const COLLECTIONS = [
  'updates', 'docs', 'decisions', 'groups', 'courses', 'quizzes', 'questionBank', 'resources', 'attachments',
  'activity', 'incidents', 'handoffs', 'roster',
];

const NEW_CONTENT_STORE = 'team-comms-hub-content-v4';
const OLD_CONTENT_STORE = 'team-comms-hub-v1';
const NEW_AUTH_STORE = 'team-comms-hub-auth-v4';
const OLD_AUTH_STORE = 'team-comms-hub-auth-v3';
const NEW_PROGRESS_STORE = 'team-comms-hub-progress-v4';
const NEW_FILE_STORE = 'team-comms-hub-files-v4';
const OLD_FILE_STORE = 'team-comms-hub-files-v3';
const RATE_STORE = 'team-comms-hub-rate-v4';
const REMINDER_STORE = 'team-comms-hub-reminders-v4';

export const contentStore = () => getStore({ name: NEW_CONTENT_STORE, consistency: 'strong' });
export const authStore = () => getStore({ name: NEW_AUTH_STORE, consistency: 'strong' });
export const progressStore = () => getStore({ name: NEW_PROGRESS_STORE, consistency: 'strong' });
export const fileStore = () => getStore({ name: NEW_FILE_STORE, consistency: 'strong' });
export const oldFileStore = () => getStore({ name: OLD_FILE_STORE, consistency: 'strong' });
export const rateStore = () => getStore({ name: RATE_STORE, consistency: 'strong' });
export const reminderStore = () => getStore({ name: REMINDER_STORE, consistency: 'strong' });

const defaultAuth = {
  users: [], sessions: {}, verificationTokens: {}, resetTokens: {}, mfaChallenges: {}, quizSessions: {}, passwordResetRequests: [], invites: [],
};

const defaultProgress = { resources: {}, modules: {}, courses: {}, quizAttempts: {}, notificationReads: {} };

function upgradeCollection(name, value) {
  const list = arr(value);
  if (name === 'updates') return list.map(item => ({
    ...item,
    approvalStatus: item.approvalStatus || 'approved',
    mandatory: Boolean(item.mandatory),
    pinned: Boolean(item.pinned),
    targetGroupIds: arr(item.targetGroupIds),
    targetUserIds: arr(item.targetUserIds),
    acknowledgements: arr(item.acknowledgements),
    attachmentIds: arr(item.attachmentIds),
  }));
  if (name === 'docs') return list.map(item => ({
    ...item,
    approvalStatus: item.approvalStatus || 'approved',
    version: item.version || 1,
    targetGroupIds: arr(item.targetGroupIds),
    attachmentIds: arr(item.attachmentIds),
    comments: arr(item.comments),
    outdatedFlags: arr(item.outdatedFlags),
  }));
  if (name === 'decisions') return list.map(item => ({ ...item, approvalStatus: item.approvalStatus || 'approved', targetGroupIds: arr(item.targetGroupIds) }));
  if (name === 'resources') return list.map(item => ({
    ...item,
    status: item.status || 'Active',
    description: item.description || '',
    category: item.category || 'General',
    version: item.version || 1,
    reviewDate: item.reviewDate || '',
    updatedAt: item.updatedAt || item.createdAt || now(),
    fileStoreVersion: item.fileStoreVersion || 'v3',
  }));
  return list;
}

function upgradeAuth(old = {}) {
  const users = arr(old.users).map(user => ({
    ...user,
    emailVerifiedAt: user.emailVerifiedAt || user.createdAt || now(),
    mfa: user.mfa || { enabled: false },
    groupIds: arr(user.groupIds),
  }));
  return {
    ...structuredClone(defaultAuth),
    users,
    sessions: old.sessions || {},
    passwordResetRequests: arr(old.passwordResetRequests),
    invites: arr(old.invites),
  };
}

export async function ensureMigrated() {
  const store = contentStore();
  const meta = await store.get('meta', { type: 'json', consistency: 'strong' });
  if (meta?.schemaVersion >= 4) return meta;

  const oldContent = getStore({ name: OLD_CONTENT_STORE, consistency: 'strong' });
  const oldWorkspace = await oldContent.get('workspace', { type: 'json', consistency: 'strong' }) || {};
  for (const name of COLLECTIONS) {
    const existing = await store.get(name, { type: 'json', consistency: 'strong' });
    if (existing === null) await store.setJSON(name, upgradeCollection(name, oldWorkspace[name] || []), { onlyIfNew: true });
  }

  const newAuth = authStore();
  const existingAuth = await newAuth.get('auth', { type: 'json', consistency: 'strong' });
  if (existingAuth === null) {
    const oldAuth = getStore({ name: OLD_AUTH_STORE, consistency: 'strong' });
    const oldAuthData = await oldAuth.get('auth', { type: 'json', consistency: 'strong' }) || {};
    await newAuth.setJSON('auth', upgradeAuth(oldAuthData), { onlyIfNew: true });
    const progress = oldAuthData.progress || {};
    const reads = oldAuthData.notificationReads || {};
    const pStore = progressStore();
    for (const user of arr(oldAuthData.users)) {
      const current = progress[user.id] || {};
      await pStore.setJSON(`user:${user.id}`, {
        ...structuredClone(defaultProgress),
        ...current,
        resources: current.resources || {},
        modules: current.modules || {},
        courses: current.courses || {},
        quizAttempts: current.quizAttempts || {},
        notificationReads: reads[user.id] || {},
      }, { onlyIfNew: true });
    }
  }

  const newMeta = {
    schemaVersion: 4,
    migratedAt: now(),
    revisions: Object.fromEntries(COLLECTIONS.map(name => [name, 1])),
    updatedAt: Object.fromEntries(COLLECTIONS.map(name => [name, now()])),
  };
  await store.setJSON('meta', newMeta, { onlyIfNew: true });
  return (await store.get('meta', { type: 'json', consistency: 'strong' })) || newMeta;
}

export async function readCollection(name) {
  await ensureMigrated();
  if (!COLLECTIONS.includes(name)) throw new Error(`Unknown collection: ${name}`);
  return (await contentStore().get(name, { type: 'json', consistency: 'strong' })) || [];
}

export async function readCollections(names = COLLECTIONS) {
  await ensureMigrated();
  const selected = names.filter(name => COLLECTIONS.includes(name));
  const values = await Promise.all(selected.map(name => readCollection(name)));
  return Object.fromEntries(selected.map((name, index) => [name, values[index]]));
}

async function mutateMeta(collection) {
  const store = contentStore();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await store.getWithMetadata('meta', { type: 'json', consistency: 'strong' });
    const data = record?.data ?? null;
    const etag = record?.etag ?? null;
    const meta = data || { schemaVersion: 4, revisions: {}, updatedAt: {} };
    meta.schemaVersion = 4;
    meta.revisions ||= {};
    meta.updatedAt ||= {};
    meta.revisions[collection] = Number(meta.revisions[collection] || 0) + 1;
    meta.updatedAt[collection] = now();
    const result = await store.setJSON('meta', meta, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (result?.modified !== false) return meta;
  }
  throw Object.assign(new Error('The workspace changed at the same time. Please retry.'), { status: 409 });
}

export async function mutateCollection(name, mutator) {
  await ensureMigrated();
  if (!COLLECTIONS.includes(name)) throw new Error(`Unknown collection: ${name}`);
  const store = contentStore();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const record = await store.getWithMetadata(name, { type: 'json', consistency: 'strong' });
    const data = record?.data ?? null;
    const etag = record?.etag ?? null;
    const current = structuredClone(data || []);
    const result = await mutator(current);
    const next = result?.value ?? current;
    const write = await store.setJSON(name, next, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (write?.modified !== false) {
      await mutateMeta(name);
      return { value: next, result: result?.result };
    }
  }
  throw Object.assign(new Error('This record was changed by someone else. Refresh and try again.'), { status: 409 });
}

export async function readMeta() {
  await ensureMigrated();
  return (await contentStore().get('meta', { type: 'json', consistency: 'strong' })) || { schemaVersion: 4, revisions: {}, updatedAt: {} };
}

export async function readAuth() {
  await ensureMigrated();
  return (await authStore().get('auth', { type: 'json', consistency: 'strong' })) || structuredClone(defaultAuth);
}

export async function mutateAuth(mutator) {
  await ensureMigrated();
  const store = authStore();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const record = await store.getWithMetadata('auth', { type: 'json', consistency: 'strong' });
    const data = record?.data ?? null;
    const etag = record?.etag ?? null;
    const auth = { ...structuredClone(defaultAuth), ...(data || {}) };
    auth.users ||= [];
    auth.sessions ||= {};
    auth.verificationTokens ||= {};
    auth.resetTokens ||= {};
    auth.mfaChallenges ||= {};
    auth.quizSessions ||= {};
    auth.passwordResetRequests ||= [];
    auth.invites ||= [];
    const result = await mutator(auth);
    const write = await store.setJSON('auth', auth, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (write?.modified !== false) return { auth, result };
  }
  throw Object.assign(new Error('Account data changed at the same time. Please retry.'), { status: 409 });
}

export async function readProgress(userId) {
  await ensureMigrated();
  const value = await progressStore().get(`user:${userId}`, { type: 'json', consistency: 'strong' });
  return {
    ...structuredClone(defaultProgress),
    ...(value || {}),
    resources: value?.resources || {},
    modules: value?.modules || {},
    courses: value?.courses || {},
    quizAttempts: value?.quizAttempts || {},
    notificationReads: value?.notificationReads || {},
  };
}

export async function mutateProgress(userId, mutator) {
  const store = progressStore();
  const key = `user:${userId}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const record = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    const data = record?.data ?? null;
    const etag = record?.etag ?? null;
    const progress = {
      ...structuredClone(defaultProgress),
      ...(data || {}),
      resources: data?.resources || {},
      modules: data?.modules || {},
      courses: data?.courses || {},
      quizAttempts: data?.quizAttempts || {},
      notificationReads: data?.notificationReads || {},
    };
    const result = await mutator(progress);
    const write = await store.setJSON(key, progress, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (write?.modified !== false) return { progress, result };
  }
  throw Object.assign(new Error('Learning progress changed at the same time. Please retry.'), { status: 409 });
}
