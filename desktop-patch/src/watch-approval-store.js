const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function failure(message,httpStatus=400){return Object.assign(new Error(message),{httpStatus});}
function createWatchStore({directory,now=Date.now,randomBytes=crypto.randomBytes}){
 if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw failure('unsafe store directory',503);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'watch-approval.json');let pairing=null;
 function guard(){if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw failure('unsafe store destination',503);}
 guard();let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{devices:[],operations:[]};
 if(!Array.isArray(state.devices)||!Array.isArray(state.operations))throw failure('invalid store',503);
 function commit(next){
  guard();const temp=path.join(directory,`.watch-${randomBytes(16).toString('hex')}.tmp`);let fd;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;guard();fs.renameSync(temp,file);const dirFd=fs.openSync(directory,'r');try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}state=next;}
  finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }
 function update(fn){const next=structuredClone(state);fn(next);commit(next);}
 if(state.operations.some(o=>o.status==='claimed'))update(s=>{for(const o of s.operations)if(o.status==='claimed'){o.status='unknown';o.message='桌宠重启，未确认交付结果。';}});
 function device(id){return state.devices.find(d=>d.id===id&&!d.revoked);}
 function beginPairing(){guard();const code=String(randomBytes(4).readUInt32BE()%1000000).padStart(6,'0');pairing={code,expiresAtMs:now()+300000,failures:0};return {code,expiresAtMs:pairing.expiresAtMs};}
 function pair(code){
  if(!pairing||now()>=pairing.expiresAtMs||pairing.failures>=10)throw failure('pairing unavailable',401);
  if(typeof code!=='string'||code!==pairing.code){pairing.failures++;throw failure('invalid code',401);}
  const token=randomBytes(32).toString('base64url'),id=crypto.randomUUID();
  update(s=>s.devices.push({id,tokenHash:hash(token),createdAtMs:now(),revoked:false}));pairing=null;return {id,token};
 }
 function authenticate(token){if(typeof token!=='string'||token.length>256)return null;const candidate=Buffer.from(hash(token),'hex');let match=null;for(const d of state.devices){const stored=Buffer.from(d.tokenHash,'hex');if(stored.length===candidate.length&&crypto.timingSafeEqual(candidate,stored)&&!d.revoked)match=d;}return match?{id:match.id}:null;}
 function revoke(id){update(s=>{const d=s.devices.find(d=>d.id===id);if(d){d.revoked=true;delete d.push;}});}
 function registerPush(id,push){
  if(!device(id))throw failure('unauthorized',401);
  if(push!==null&&(!/^[0-9a-f]{64,200}$/i.test(push?.token||'')||!['sandbox','production'].includes(push?.environment)))throw failure('invalid push registration');
  update(s=>{const d=s.devices.find(d=>d.id===id);if(push===null)delete d.push;else {const normalized={token:push.token.toLowerCase(),environment:push.environment};for(const other of s.devices)if(other.id!==id&&other.push?.token===normalized.token&&other.push.environment===normalized.environment)delete other.push;d.push=normalized;}});
 }
 function getOperation(id,op){const found=state.operations.find(o=>o.deviceId===id&&o.operationId===op);return found?structuredClone(found):null;}
 function recordClaim(id,input){if(!device(id))throw failure('unauthorized',401);if(getOperation(id,input.operationId))throw failure('operation exists',409);update(s=>{s.operations=s.operations.filter(o=>now()-o.recordedAtMs<86400000);if(s.operations.length>=1024)throw failure('operation capacity reached',503);s.operations.push({...input,deviceId:id,status:'claimed',recordedAtMs:now()});});return getOperation(id,input.operationId);}
 function finishOperation(id,result){update(s=>{const o=s.operations.find(o=>o.deviceId===id&&o.operationId===result.operationId);if(!o)throw failure('operation missing',404);o.status=result.status;if(result.message)o.message=result.message;});return getOperation(id,result.operationId);}
 return {directory,beginPairing,cancelPairing:()=>{pairing=null;},pair,authenticate,revoke,registerPush,getOperation,recordClaim,finishOperation,listDevices:()=>state.devices.filter(d=>!d.revoked).map(({id,createdAtMs,push})=>({id,createdAtMs,push:push?{...push}:undefined}))};
}
module.exports={createWatchStore,failure};
