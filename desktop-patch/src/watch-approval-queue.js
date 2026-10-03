const {randomUUID,createHash}=require('node:crypto');
const path=require('node:path');
const AGENTS=new Set(['codex','claude-code','kimi-cli','deepseek-harness']);
const UNSUPPORTED=new Set(['AskUserQuestion','ExitPlanMode','EnterPlanMode']);
// Sort recursively so revisions bind semantics rather than property insertion order.
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
function createApprovalQueue({getPendingPermissions,getSessions=()=>({}),isSuppressed=()=>false,now=Date.now,randomUUID:uuid=randomUUID,maxDetailBytes=8192}){
 const identities=new WeakMap(),claims=new WeakSet();
 function project(entry){
  if(!AGENTS.has(entry.agentId)||isSuppressed(entry)||entry.isCodexNotify||entry.isKimiNotify||entry.isElicitation||entry._delayedResolve||UNSUPPORTED.has(entry.toolName)||claims.has(entry))return null;
  if(!entry.isDeepseek&&(!entry.res||entry.res.writableEnded||entry.res.destroyed))return null;
  if(entry.isDeepseek&&(!Number.isInteger(entry.deepseek?.port)||!entry.deepseek?.rpcId||!entry.deepseek?.approvalId))return null;
  let id=identities.get(entry);if(!id){id=uuid();identities.set(entry,id);}
  const input=entry.watchToolInput??entry.toolInput??{};
  let details,semantic;try{details=JSON.stringify(stable(input),null,2);semantic=JSON.stringify(stable({agentId:entry.agentId,sessionId:entry.sessionId,toolName:entry.toolName,toolInput:input,deepseek:entry.deepseek}));}catch{return null;}
  const revision=createHash('sha256').update(semantic).digest('hex');
  const createdAtMs=Number.isFinite(entry.createdAt)?entry.createdAt:now();
  const expiresAtMs=Math.min(createdAtMs+300000,Number.isFinite(entry.expiresAt)?entry.expiresAt:Infinity);
  const oversize=Buffer.byteLength(details)>maxDetailBytes;
  const sessions=getSessions();const session=sessions instanceof Map?sessions.get(entry.sessionId):sessions?.[entry.sessionId];
  return {id,revision,agentId:entry.agentId,sessionLabel:String(session?.alias||entry.sessionId||''),projectLabel:path.basename(session?.cwd||entry.cwd||''),toolName:String(entry.toolName||'Tool'),details:oversize?'操作详情过长，请在桌面处理。':details,createdAtMs,expiresAtMs,canDecide:!oversize&&!entry.watchDetailsUnavailable&&now()<expiresAtMs,...(entry.watchDetailsUnavailable?{desktopReason:'details-unavailable'}:oversize?{desktopReason:'details-too-long'}:{})};
 }
 function snapshot(){return getPendingPermissions().map(project).filter(Boolean);}
 function validate(input){
  if(!['allow','deny'].includes(input.decision))return {error:'invalid-decision',httpStatus:400};
  const entry=getPendingPermissions().find(e=>identities.get(e)===input.requestId);
  if(!entry)return {error:'handled-elsewhere',httpStatus:409};
  const card=project(entry);if(!card)return {error:'unavailable',httpStatus:409};
  if(now()>=card.expiresAtMs)return {error:'expired',httpStatus:410};
  if(!card.canDecide||card.revision!==input.revision)return {error:'stale-or-incomplete',httpStatus:409};
  return {entry,card};
 }
 function claim(input){const result=validate(input);if(result.entry)claims.add(result.entry);return result;}
 return {snapshot,validate,claim};
}
module.exports={createApprovalQueue};
