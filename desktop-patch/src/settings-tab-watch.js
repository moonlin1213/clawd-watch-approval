(function(root){
 const core=root.ClawdSettingsCore;
 core.tabs.watch={render(parent){const title=document.createElement('h1');title.textContent=core.helpers.t('sidebarWatch');const p=document.createElement('p');p.textContent=core.helpers.t('watchDescription');const button=document.createElement('button');button.textContent=core.helpers.t('watchConfigure');button.onclick=async()=>{const result=await window.settingsAPI.command('openWatchPairing');if(result.status!=='ok')p.textContent=result.message;};parent.append(title,p,button);}};
})(globalThis);
