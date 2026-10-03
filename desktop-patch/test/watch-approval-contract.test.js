const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createApprovalQueue}=require('../src/watch-approval-queue');const {createWatchStore}=require('../src/watch-approval-store');const {createApprovalService}=require('../src/watch-approval-service');const {createWatchApprovalServer}=require('../src/watch-approval-server');
test('live Node HTTP contract produces the Swift interoperability fixture',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'watch-contract-test-'));const store=createWatchStore({directory});const device=store.pair(store.beginPairing().code);
 const entry={agentId:'kimi-cli',isKimi:true,res:{},createdAt:1000,toolName:'Bash',toolInput:{command:'pwd'},sessionId:'fixture'};
 const queue=createApprovalQueue({getPendingPermissions:()=>[entry],now:()=>1000,randomUUID:()=> '12345678-1234-4234-8234-123456789abc'});
 const service=createApprovalService({queue,store,deliver:async()=>({status:'delivered'})});const server=createWatchApprovalServer({queue,store,service});const {port}=await server.start();t.after(async()=>{await server.stop();fs.rmSync(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}/api/clawd-watch/v1`;const headers={authorization:`Bearer ${device.token}`,'content-type':'application/json'};
 const snapshot=await (await fetch(base+'/approvals',{headers})).json();const c=snapshot.approvals[0];assert.equal(c.agentId,'kimi-cli');
 const operation=await(await fetch(base+`/approvals/${c.id}/decision`,{method:'POST',headers,body:JSON.stringify({operationId:'87654321-1234-4234-8234-123456789abc',requestId:c.id,revision:c.revision,decision:'deny'})})).json();assert.equal(operation.status,'delivered');assert.equal(operation.deviceId,undefined);
 fs.writeFileSync(process.env.CLAWD_WATCH_CONTRACT_FIXTURE || path.join(directory,'node-contract.json'),JSON.stringify({...snapshot,operation},null,2)+'\n');
});
