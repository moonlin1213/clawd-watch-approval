const path=require('node:path');const {pathToFileURL}=require('node:url');
function isValidWatchURL(value){
 if(typeof value!=='string'||value.length>2048)return false;
 try{const u=new URL(value);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/api/clawd-watch/v1'&&!value.includes('%')&&!value.includes('\\');}catch{return false;}
}
function createWatchApprovalSettings({controller,server,store,BrowserWindow,ipcMain,pairingFile=path.join(__dirname,'watch-approval-pairing.html'),onStart=()=>{},onStop=()=>{}}){
 let window=null,error=null,active=false,chain=Promise.resolve();
 function sync(){chain=chain.then(async()=>{try{if(controller.get('watchApprovalsEnabled')){if(!active){await server.start();active=true;onStart();}}else if(active){onStop();store.cancelPairing?.();await server.stop();active=false;}error=null;}catch{error='手表服务未启动，请检查端口和本地配置。';}});return chain;}
 const unsub=controller.subscribeKey('watchApprovalsEnabled',sync);const ready=sync();const channels=[];
 const fileURL=pathToFileURL(pairingFile).href;
 function trusted(event){if(!window||window.isDestroyed()||event.sender!==window.webContents||event.sender.getURL()!==fileURL||event.senderFrame?.url!==fileURL||event.senderFrame?.parent)throw Error('untrusted pairing frame');}
 const status=()=>({enabled:controller.get('watchApprovalsEnabled'),publicURL:controller.get('watchApprovalPublicURL'),...server.getStatus(),error,devices:store.listDevices().map(({id,createdAtMs})=>({id,createdAtMs}))});
 if(ipcMain){for(const [name,fn] of Object.entries({
  status:()=>status(),
  configure:async input=>{if(!input||typeof input.enabled!=='boolean'||!isValidWatchURL(input.publicURL))throw Error('invalid Watch settings');const result=await controller.applyBulk({watchApprovalsEnabled:input.enabled,watchApprovalPublicURL:input.publicURL});await chain;return {result,...status()};},
  pair:()=>{if(!controller.get('watchApprovalsEnabled')||!server.getStatus().port)throw Error('请先开启手表审批。');return {...store.beginPairing(),publicURL:controller.get('watchApprovalPublicURL')};},
  revoke:id=>{if(typeof id!=='string')throw Error('invalid device');store.revoke(id);return status();},
 })){const channel=`clawd-watch:${name}`;ipcMain.handle(channel,async(event,input)=>{trusted(event);return fn(input);});channels.push(channel);}}
 function openPairingWindow(){
  if(window&&!window.isDestroyed()){window.focus();return;}
  window=new BrowserWindow({width:520,height:590,title:'Clawd Watch',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'watch-approval-pairing-preload.js')}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.loadFile(pairingFile);window.on('closed',()=>{window=null;store.cancelPairing?.();});
 }
 return {ready,settle:()=>chain,openPairingWindow,revokeDevice:id=>store.revoke(id),getStatus:status,dispose:async()=>{unsub();onStop();await chain;await server.stop();store.cancelPairing?.();if(window&&!window.isDestroyed())window.close();for(const c of channels)ipcMain.removeHandler(c);}};
}
module.exports={createWatchApprovalSettings,isValidWatchURL};
