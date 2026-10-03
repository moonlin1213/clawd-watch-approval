const {failure}=require('./watch-approval-store');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function createApprovalService({queue,store,deliver}){
 async function submit(device,input){
  if(!input||!UUID.test(input.operationId)||typeof input.requestId!=='string'||typeof input.revision!=='string'||!['allow','deny'].includes(input.decision))throw failure('invalid decision');
  const old=store.getOperation(device.id,input.operationId);
  if(old){if(old.requestId!==input.requestId||old.revision!==input.revision||old.decision!==input.decision)throw failure('operation conflict',409);return old;}
  const valid=queue.validate(input);if(!valid.entry)throw failure(valid.error,valid.httpStatus);
  store.recordClaim(device.id,input);
  const claimed=queue.claim(input);
  if(!claimed.entry)return store.finishOperation(device.id,{...input,status:claimed.httpStatus===410?'expired':'handledElsewhere',message:claimed.error});
  let outcome;try{outcome=await deliver(claimed.entry,input.decision);}catch{outcome={status:'unknown',message:'未确认决定交付，请在原生界面核对。'};}
  if(!['delivered','handledElsewhere','expired','unknown'].includes(outcome?.status))outcome={status:'unknown'};
  try{return store.finishOperation(device.id,{...input,...outcome});}catch{return {...input,status:'unknown',message:'回执保存失败，请查询同一操作。'};}
 }
 return {submit};
}
module.exports={createApprovalService};
