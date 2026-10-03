const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('clawdWatch',Object.freeze({
 status:()=>ipcRenderer.invoke('clawd-watch:status'),
 configure:input=>ipcRenderer.invoke('clawd-watch:configure',input),
 pair:()=>ipcRenderer.invoke('clawd-watch:pair'),
 revoke:id=>ipcRenderer.invoke('clawd-watch:revoke',id),
}));
