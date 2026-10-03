function createApprovalDelivery({resolvePermissionEntry,getPendingPermissions}){
 return async function deliver(entry,decision){
  if(!getPendingPermissions().includes(entry)||(!entry.isDeepseek&&(!entry.res||entry.res.writableEnded||entry.res.destroyed)))return {status:'handledElsewhere'};
  const message=decision==='deny'?'用户通过手表拒绝。':undefined;
  if(entry.isDeepseek){
   try{const result=await resolvePermissionEntry(entry,decision,message,{allowOnce:true});return result&&typeof result.status==='string'?result:{status:'unknown'};}
   catch{return {status:'unknown'};}
  }
  return new Promise(resolve=>{
   const res=entry.res;let done=false;
   const finish=status=>{if(done)return;done=true;clearTimeout(timer);res.removeListener('finish',onFinish);res.removeListener('close',onClose);res.removeListener('error',onError);resolve({status});};
   const onFinish=()=>finish('delivered'),onClose=()=>finish(res.writableFinished?'delivered':'unknown'),onError=()=>finish('unknown');
   const timer=setTimeout(()=>finish('unknown'),5000);
   res.once('finish',onFinish);res.once('close',onClose);res.once('error',onError);
   try{const sent=resolvePermissionEntry(entry,decision,message,{allowOnce:true});if(sent!==true)finish('unknown');else if(res.writableFinished)finish('delivered');}
   catch{finish('unknown');}
  });
 };
}
module.exports={createApprovalDelivery};
