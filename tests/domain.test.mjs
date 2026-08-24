import test from 'node:test';
import assert from 'node:assert/strict';
import {assignedCourse,targetMatches,visibleItem,validatePassword,hashPassword,verifyPassword,totpCode,verifyTotp,validateUploadedFile} from '../netlify/functions/lib/domain.mjs';

test('viewer visibility respects draft/archive/approval',()=>{
  const viewer={id:'u1',role:'viewer',groupIds:[]};
  assert.equal(visibleItem({status:'Active',approvalStatus:'approved'},viewer),true);
  assert.equal(visibleItem({status:'Draft',approvalStatus:'approved'},viewer),false);
  assert.equal(visibleItem({status:'Active',approvalStatus:'pending'},viewer),false);
});

test('group targeting does not leak to unrelated users',()=>{
  const item={targetGroupIds:['g1'],targetUserIds:[]};
  assert.equal(targetMatches(item,{id:'u1',groupIds:['g1']}),true);
  assert.equal(targetMatches(item,{id:'u2',groupIds:['g2']}),false);
});

test('course assignment targets user or group and requires Active',()=>{
  const user={id:'u1',groupIds:['g1']};
  assert.equal(assignedCourse({status:'Active',assignedGroupIds:['g1'],assignedUserIds:[]},user),true);
  assert.equal(assignedCourse({status:'Active',assignedGroupIds:['g2'],assignedUserIds:[]},user),false);
  assert.equal(assignedCourse({status:'Draft',assignedGroupIds:['g1'],assignedUserIds:[]},user),false);
});

test('password hashes verify without storing plaintext',()=>{
  assert.equal(validatePassword('Password123'),true);
  assert.equal(validatePassword('short1'),false);
  const stored=hashPassword('Password123');
  assert.notEqual(stored,'Password123');
  assert.equal(verifyPassword('Password123',stored),true);
  assert.equal(verifyPassword('Wrong12345',stored),false);
});

test('TOTP verifies current code',()=>{
  const secret='JBSWY3DPEHPK3PXP';
  const code=totpCode(secret);
  assert.match(code,/^\d{6}$/);
  assert.equal(verifyTotp(secret,code),true);
});

test('unsafe HTML uploads are rejected',()=>{
  assert.throws(()=>validateUploadedFile({fileName:'payload.html',dataBase64:Buffer.from('<script>alert(1)</script>').toString('base64')}),/Unsupported file type/);
});

test('file content must match extension',()=>{
  assert.throws(()=>validateUploadedFile({fileName:'fake.pdf',dataBase64:Buffer.from('not a pdf').toString('base64')}),/contents do not match/);
});
