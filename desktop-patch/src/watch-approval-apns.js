const fs=require('node:fs');const crypto=require('node:crypto');const http2=require('node:http2');
const TOPIC='org.example.clawdwatch.watchapp';
function createWatchPushSender({store,queue,keyConfig,http2Connect=http2.connect,now=Date.now}){
 if(keyConfig?.topic!==TOPIC||!keyConfig.teamId||!keyConfig.keyId||!keyConfig.privateKeyPath)throw Error('invalid Watch APNs configuration');
 const receipts=new Map(),clients=new Set();let stopped=false,busy=false,cachedJWT=null,key=null;
 function jwt(){
  if(cachedJWT&&now()-cachedJWT.at<1200000)return cachedJWT.value;
  if(!key)key=crypto.createPrivateKey(fs.readFileSync(keyConfig.privateKeyPath));
  const header=Buffer.from(JSON.stringify({alg:'ES256',kid:keyConfig.keyId})).toString('base64url');
  const claims=Buffer.from(JSON.stringify({iss:keyConfig.teamId,iat:Math.floor(now()/1000)})).toString('base64url');
  const data=header+'.'+claims;const signature=crypto.sign('sha256',Buffer.from(data),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
  cachedJWT={at:now(),value:data+'.'+signature};return cachedJWT.value;
 }
 function send(push,card){return new Promise(resolve=>{
  let client,stream,status=0,finished=false;const timer=setTimeout(()=>finish(0),10000);
  function finish(code){if(finished)return;finished=true;clearTimeout(timer);clients.delete(client);try{stream?.close();client?.close();}catch{}resolve(code);}
  try{
   const host=push.environment==='sandbox'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com';
   client=http2Connect(host);clients.add(client);client.on('error',()=>finish(0));client.on('close',()=>finish(status));
   stream=client.request({':method':'POST',':path':'/3/device/'+push.token,authorization:'bearer '+jwt(),'apns-topic':TOPIC,'apns-push-type':'alert','apns-priority':'10','apns-collapse-id':card.id,'apns-expiration':String(Math.floor(card.expiresAtMs/1000))});
   stream.on('response',headers=>{status=Number(headers[':status']);});stream.on('error',()=>finish(0));stream.on('end',()=>finish(status));stream.on('close',()=>finish(status));stream.setEncoding('utf8');let bytes=0;
   stream.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>4096)finish(0);});
   const agent={codex:'Codex','claude-code':'Claude Code','kimi-cli':'Kimi','deepseek-harness':'DSH'}[card.agentId]||'Agent';
   stream.end(JSON.stringify({aps:{alert:{title:agent+' 等待审批',body:'打开手表查看操作详情。'},sound:'default',category:'CLAWD_APPROVAL','thread-id':'clawd-approval'},requestId:card.id,revision:card.revision}));
  }catch{finish(0);}
 });}
 async function scan(){
  if(stopped||busy)return;busy=true;
  try{
   const cards=queue.snapshot().filter(c=>c.canDecide&&now()<c.expiresAtMs);for(const [identity,receipt] of receipts)if(now()>=receipt.expiresAtMs)receipts.delete(identity);
   for(const d of store.listDevices())for(const card of cards){
    if(!d.push||stopped)continue;
    const identity=[crypto.createHash('sha256').update(d.push.token).digest('hex'),d.push.environment,card.id,card.revision].join(':');
    let receipt=receipts.get(identity);if(!receipt){if(receipts.size>=4096)continue;receipt={attempt:0,due:now(),done:false,expiresAtMs:Math.max(card.expiresAtMs,Number.isFinite(card.createdAtMs)?card.createdAtMs+300000:0)};receipts.set(identity,receipt);}
    if(receipt.done||now()<receipt.due||now()>=card.expiresAtMs)continue;
    receipt.attempt++;const code=await send(d.push,card);
    if(code===410){const current=store.listDevices().find(x=>x.id===d.id);if(current?.push?.token===d.push.token&&current.push.environment===d.push.environment)store.registerPush(d.id,null);receipt.done=true;}
    else if(code===200)receipt.done=true;
    else if([0,429,500,503].includes(code)&&receipt.attempt<4)receipt.due=now()+[5000,30000,120000][receipt.attempt-1];
    else receipt.done=true;
   }
  }finally{busy=false;}
 }
 return {scan,start:()=>{stopped=false;},stop:()=>{stopped=true;for(const c of clients){try{c.destroy();}catch{}}clients.clear();}};
}
module.exports={createWatchPushSender,TOPIC};
