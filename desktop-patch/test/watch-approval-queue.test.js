const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApprovalQueue}=require('../src/watch-approval-queue');
function fixture(agentId='codex') {
  const entry={agentId,isCodex:agentId==='codex',isKimi:agentId==='kimi-cli',isDeepseek:agentId==='deepseek-harness',sessionId:'session',createdAt:1000,toolName:'Bash',toolInput:{command:'pwd'},res:{writableEnded:false,destroyed:false},deepseek:{port:3080,rpcId:'rpc',approvalId:'a'}};
  let time=1000,suppressed=false; const entries=[entry];
  const queue=createApprovalQueue({getPendingPermissions:()=>entries,getSessions:()=>({session:{cwd:'/tmp/project'}}),isSuppressed:()=>suppressed,now:()=>time});
  return {entry,entries,queue,setTime:v=>time=v,suppress:()=>suppressed=true};
}
for(const agent of ['codex','claude-code','kimi-cli','deepseek-harness']) test(`projects and claims ${agent} once`,()=>{
 const {entry,queue}=fixture(agent); const [card]=queue.snapshot();assert.equal(card.agentId,agent); assert.equal(queue.snapshot()[0].id,card.id);
 const input={requestId:card.id,revision:card.revision,decision:'allow'};assert.equal(queue.claim(input).entry,entry);assert.equal(queue.claim(input).httpStatus,409);
});
test('changed raw semantics reject stale revision',()=>{const {queue,entry}=fixture();const [c]=queue.snapshot();entry.toolInput.command='rm file';assert.equal(queue.claim({requestId:c.id,revision:c.revision,decision:'allow'}).httpStatus,409);});
test('separate objects in one session never share request identity',()=>{const {queue,entries,entry}=fixture();entries.push({...entry});const cards=queue.snapshot();assert.notEqual(cards[0].id,cards[1].id);});
test('oversized details cannot be approved from truncated text',()=>{const {queue,entry}=fixture();entry.toolInput={command:'x'.repeat(8193)};const [c]=queue.snapshot();assert.equal(c.canDecide,false);assert.equal(queue.claim({requestId:c.id,revision:c.revision,decision:'allow'}).httpStatus,409);});
test('remote expiry leaves local request intact',()=>{const f=fixture();const [c]=f.queue.snapshot();f.setTime(301001);assert.equal(f.queue.claim({requestId:c.id,revision:c.revision,decision:'allow'}).httpStatus,410);assert.equal(f.entries.length,1);});
test('shorter native deadline overrides five minute maximum',()=>{const f=fixture();f.entry.expiresAt=2000;assert.equal(f.queue.snapshot()[0].expiresAtMs,2000);});
test('DND, passive, elicitation, closed socket and disabled gates exclude requests',()=>{
 for(const fields of [{isCodexNotify:true},{isKimiNotify:true},{isElicitation:true},{toolName:'AskUserQuestion'},{toolName:'ExitPlanMode'},{res:{writableEnded:true}},{res:{destroyed:true}},{agentId:'pi'},{_delayedResolve:true}]){const f=fixture();Object.assign(f.entry,fields);assert.equal(f.queue.snapshot().length,0,JSON.stringify(fields));}
 const f=fixture();f.suppress();assert.equal(f.queue.snapshot().length,0);
});
test('gate is checked again on submit',()=>{const f=fixture();const [c]=f.queue.snapshot();f.suppress();assert.equal(f.queue.claim({requestId:c.id,revision:c.revision,decision:'deny'}).httpStatus,409);});
