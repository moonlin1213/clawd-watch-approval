const http=require('node:http');const {failure}=require('./watch-approval-store');
const PREFIX='/api/clawd-watch/v1';
const ID='[0-9a-f-]{36}';
function createWatchApprovalServer({store,queue,service,now=Date.now,createServer=http.createServer}){
 let server=null,port=null;const rates=new Map();
 function reply(res,status,data){
  let body=JSON.stringify(data);if(Buffer.byteLength(body)>131072){status=503;body=JSON.stringify({error:'snapshot-too-large'});}
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);
 }
 function limited(key){const time=now();let r=rates.get(key);if(!r||time-r.start>=60000){r={start:time,count:0};rates.set(key,r);}if(rates.size>2048)for(const [k,v] of rates)if(time-v.start>=60000)rates.delete(k);return ++r.count>120;}
 function body(req){return new Promise((resolve,reject)=>{
  let text='',size=0,tooLarge=Number(req.headers['content-length'])>16384;
  req.on('data',chunk=>{size+=chunk.length;if(size>16384)tooLarge=true;if(!tooLarge)text+=chunk;});
  req.on('error',reject);req.on('aborted',()=>reject(failure('request aborted')));
  req.on('end',()=>{if(tooLarge)return reject(failure('body too large',413));try{resolve(JSON.parse(text));}catch{reject(failure('invalid JSON'));}});
 });}
 async function handle(req,res){
  try{
   const url=req.url||'';
   if(!url.startsWith(PREFIX+'/')||/[?%#\\]/.test(url)||url.includes('//')||url.split('/').some(p=>p==='.'||p==='..'))return reply(res,404,{error:'not found'});
   const route=url.slice(PREFIX.length);let method;
   if(route==='/pair'||route==='/device/push')method='POST';
   else if(route==='/approvals'||new RegExp(`^/operations/${ID}$`,'i').test(route))method='GET';
   else if(new RegExp(`^/approvals/${ID}/decision$`,'i').test(route))method='POST';
   else return reply(res,404,{error:'not found'});
   if(req.method!==method){res.setHeader('allow',method);return reply(res,405,{error:'method not allowed'});}
   if(req.headers.origin)return reply(res,403,{error:'browser origin prohibited'});
   const auth=req.headers.authorization;const device=route==='/pair'?null:store.authenticate(typeof auth==='string'&&auth.startsWith('Bearer ')?auth.slice(7):null);
   if(route!=='/pair'&&!device)return reply(res,401,{error:'unauthorized'});
   if(limited(device?.id||`pair:${req.socket.remoteAddress}`))return reply(res,429,{error:'rate limit'});
   if(route==='/pair'){const input=await body(req);return reply(res,200,store.pair(input?.code));}
   if(route==='/approvals')return reply(res,200,{approvals:queue.snapshot()});
   if(route==='/device/push'){store.registerPush(device.id,await body(req));return reply(res,200,{registered:true});}
   if(route.startsWith('/operations/')){const operation=store.getOperation(device.id,route.split('/')[2]);return operation?reply(res,200,publicOperation(operation)):reply(res,404,{error:'operation not found'});}
   const input=await body(req);if(input?.requestId!==route.split('/')[2])throw failure('request ID mismatch');
   return reply(res,200,publicOperation(await service.submit(device,input)));
  }catch(e){reply(res,e.httpStatus||503,{error:e.httpStatus?e.message:'temporarily unavailable'});}
 }
 async function start(){
  if(server)return {port};
  for(let candidate=23940;candidate<=23949;candidate++){
   const instance=createServer((req,res)=>{void handle(req,res);});instance.requestTimeout=15000;instance.headersTimeout=10000;instance.keepAliveTimeout=5000;instance.timeout=20000;
   try{await new Promise((resolve,reject)=>{instance.once('error',reject);instance.listen(candidate,'127.0.0.1',()=>{instance.removeListener('error',reject);resolve();});});server=instance;port=candidate;return {port};}
   catch(e){instance.close();if(e.code!=='EADDRINUSE')throw e;}
  }throw failure('no available Watch port',503);
 }
 async function stop(){const s=server;server=null;port=null;rates.clear();if(!s)return;await new Promise(resolve=>{s.close(resolve);s.closeAllConnections?.();});}
 return {start,stop,getStatus:()=>({running:!!server,port})};
}
function publicOperation(o){const {operationId,requestId,decision,status,message}=o;return {operationId,requestId,decision,status,...(message?{message}:{})};}
module.exports={createWatchApprovalServer,PREFIX};
