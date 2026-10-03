const $=id=>document.getElementById(id);
async function show(){const s=await window.clawdWatch.status();$('enabled').checked=s.enabled;$('url').value=s.publicURL||'';$('message').textContent=s.error||`服务${s.running?'运行中，端口 '+s.port:'已关闭'}`;$('devices').replaceChildren();for(const d of s.devices){const row=document.createElement('p');row.className='device';row.textContent=d.id;const button=document.createElement('button');button.textContent='撤销配对';button.onclick=()=>run(async()=>{await window.clawdWatch.revoke(d.id);await show();});row.append(button);$('devices').append(row);}}
async function run(fn){try{await fn();}catch(e){$('message').textContent=e.message;}}
$('save').onclick=()=>run(async()=>{const s=await window.clawdWatch.configure({enabled:$('enabled').checked,publicURL:$('url').value.trim()});if(s.result.status!=='ok')throw Error(s.result.message);await show();});
$('pair').onclick=()=>run(async()=>{const p=await window.clawdWatch.pair();$('code').textContent=p.code;$('expiry').textContent=`五分钟内在手表输入地址和此代码。截止 ${new Date(p.expiresAtMs).toLocaleTimeString()}`;});
void run(show);
