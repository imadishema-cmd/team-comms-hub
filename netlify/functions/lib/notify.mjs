import crypto from 'node:crypto';

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
export const bool = value => value === true || value === 'true';
export const arr = value => (Array.isArray(value) ? value : []);
export const normalizeEmail = value => clean(value, 240).toLowerCase();

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export function allowedEmail(email) {
  const domains = clean(process.env.ALLOWED_EMAIL_DOMAINS || '', 1000)
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  if (!domains.length) return true;
  const domain = email.split('@')[1] || '';
  return domains.includes(domain);
}

export function sessionDays() {
  const value = Number(process.env.SESSION_DAYS || 14);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 90) : 14;
}

export function maxUploadBytes() {
  const value = Number(process.env.MAX_UPLOAD_MB || 8);
  return Math.max(1, Math.min(value, 12)) * 1024 * 1024;
}

export function canEdit(user) {
  return ['editor', 'admin'].includes(user?.role);
}

export function isAdmin(user) {
  return user?.role === 'admin';
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    groupIds: arr(user.groupIds),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    emailVerified: Boolean(user.emailVerifiedAt),
    mfaEnabled: Boolean(user.mfa?.enabled),
  };
}

export function contentLabel(collection, item) {
  if (collection === 'updates') return item.title;
  if (collection === 'docs') return item.title;
  if (collection === 'decisions') return item.decision;
  if (collection === 'incidents') return item.title;
  if (collection === 'handoffs') return `${item.shiftName || 'Shift'} handoff`;
  if (collection === 'roster') return item.name || item.email || 'Roster entry';
  if (collection === 'courses') return item.title;
  if (collection === 'resources') return item.title;
  return item.title || item.name || item.id || 'Item';
}

export function approvalDefault(user) {
  return isAdmin(user) ? 'approved' : 'pending';
}

export function visibleItem(item, user) {
  if (isAdmin(user) || canEdit(user)) return true;
  if (item.status === 'Archived' || item.status === 'Draft') return false;
  if (item.expiresAt && new Date(item.expiresAt) < new Date()) return false;
  return (item.approvalStatus || 'approved') === 'approved';
}

export function targetMatches(item, user) {
  const groups = arr(item.targetGroupIds);
  const users = arr(item.targetUserIds);
  if (!groups.length && !users.length) return true;
  return users.includes(user.id) || groups.some(groupId => arr(user.groupIds).includes(groupId));
}

export function assignedCourse(course, user) {
  if (course.status !== 'Active') return false;
  const userGroups = arr(user.groupIds);
  const courseGroups = arr(course.assignedGroupIds);
  const courseUsers = arr(course.assignedUserIds);
  if (!courseGroups.length && !courseUsers.length) return true;
  return courseUsers.includes(user.id) || courseGroups.some(groupId => userGroups.includes(groupId));
}

export function computeCourseProgress(course, progress) {
  const modules = arr(course.modules);
  if (!modules.length) return { percent: 0, completed: false, completedCount: 0, total: 0 };
  let completed = 0;
  for (const module of modules) {
    if (progress.modules?.[`${course.id}:${module.id}`]?.completed) completed += 1;
  }
  return {
    percent: Math.round((completed / modules.length) * 100),
    completed: completed === modules.length,
    completedCount: completed,
    total: modules.length,
  };
}

export function sanitizeQuestion(question) {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    options: arr(question.options),
    tags: arr(question.tags),
  };
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored = '') {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  }
  return output;
}

export function base32Decode(value) {
  let bits = '';
  for (const char of String(value).replace(/=+$/g, '').toUpperCase()) {
    const position = BASE32_ALPHABET.indexOf(char);
    if (position < 0) continue;
    bits += position.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secret, time = Date.now(), step = 30) {
  const counter = Math.floor(time / 1000 / step);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(value % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret, code) {
  const normalized = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const nowMs = Date.now();
  return [-30_000, 0, 30_000].some(offset => totpCode(secret, nowMs + offset) === normalized);
}

export function sanitizeFileName(name) {
  return clean(name, 180).replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim() || 'file';
}

const FILE_TYPES = {
  pdf: { mime: 'application/pdf', inline: true, magic: buffer => buffer.subarray(0, 5).toString() === '%PDF-' },
  png: { mime: 'image/png', inline: true, magic: buffer => buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
  jpg: { mime: 'image/jpeg', inline: true, magic: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  jpeg: { mime: 'image/jpeg', inline: true, magic: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  gif: { mime: 'image/gif', inline: true, magic: buffer => ['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString()) },
  webp: { mime: 'image/webp', inline: true, magic: buffer => buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP' },
  txt: { mime: 'text/plain; charset=utf-8', inline: true, magic: buffer => !buffer.includes(0) },
  csv: { mime: 'text/csv; charset=utf-8', inline: true, magic: buffer => !buffer.includes(0) },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false, magic: buffer => buffer[0] === 0x50 && buffer[1] === 0x4b },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', inline: false, magic: buffer => buffer[0] === 0x50 && buffer[1] === 0x4b },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', inline: false, magic: buffer => buffer[0] === 0x50 && buffer[1] === 0x4b },
  mp4: { mime: 'video/mp4', inline: true, magic: buffer => buffer.length > 12 && buffer.subarray(4,8).toString() === 'ftyp' },
};

export function validateUploadedFile({ fileName, dataBase64 }) {
  const safeName = sanitizeFileName(fileName);
  const extension = safeName.split('.').pop()?.toLowerCase() || '';
  const type = FILE_TYPES[extension];
  if (!type) {
    throw Object.assign(new Error('Unsupported file type. Allowed: PDF, DOCX, PPTX, XLSX, PNG, JPG, GIF, WEBP, TXT, CSV, MP4.'), { status: 415 });
  }
  let buffer;
  try {
    buffer = Buffer.from(String(dataBase64 || ''), 'base64');
  } catch {
    throw Object.assign(new Error('The uploaded file could not be decoded.'), { status: 400 });
  }
  if (!buffer.length) throw Object.assign(new Error('The uploaded file is empty.'), { status: 400 });
  if (buffer.length > maxUploadBytes()) {
    throw Object.assign(new Error(`The file exceeds the ${Math.round(maxUploadBytes()/1024/1024)} MB upload limit.`), { status: 413 });
  }
  if (!type.magic(buffer)) throw Object.assign(new Error('The file contents do not match the selected file type.'), { status: 415 });
  return { fileName: safeName, extension, mimeType: type.mime, inline: type.inline, buffer, size: buffer.length };
}
