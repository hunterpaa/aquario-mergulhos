const express = require('express');
const { spawn, execSync } = require('child_process');

const MANAGER_PORT = 3004;
const APP_PORT     = 3005;
const APP_ENTRY    = 'server/server.js';

const app = express();
app.use(express.json());

let serverProcess = null;
let manualStop    = false;
let logs          = [];
const MAX_LOGS    = 500;
const clients     = [];

function addLog(text, type = 'info') {
  const now  = new Date();
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = { text, type, time };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  clients.forEach(res => res.write(`data: ${JSON.stringify(entry)}\n\n`));
}

function getStatus() {
  return serverProcess && !serverProcess.killed ? 'online' : 'offline';
}

function killTree(pid) {
  try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
}

function freePort() {
  try {
    execSync(
      `for /f "tokens=5" %a in ('netstat -aon ^| findstr " :${APP_PORT} "') do @taskkill /F /PID %a`,
      { shell: 'cmd.exe', stdio: 'ignore' }
    );
  } catch {}
}

function startServer() {
  if (getStatus() === 'online') return;
  addLog(`Liberando porta ${APP_PORT}...`, 'info');
  freePort();
  setTimeout(() => {
    serverProcess = spawn('node', [APP_ENTRY], {
      cwd: __dirname,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { PORT: String(APP_PORT) }),
    });
    addLog('Iniciando servidor...', 'info');
    serverProcess.stdout.on('data', d => {
      d.toString().split('\n').map(l => l.trim()).filter(l => l).forEach(l => addLog(l, 'success'));
    });
    serverProcess.stderr.on('data', d => {
      d.toString().split('\n').map(l => l.trim()).filter(l => l).forEach(l => {
        if (l.includes('EADDRINUSE')) addLog(`Erro: porta ${APP_PORT} ainda em uso.`, 'error');
        else addLog(l, 'error');
      });
    });
    serverProcess.on('error', err => {
      addLog('Falha ao iniciar: ' + err.message, 'error');
      serverProcess = null;
    });
    serverProcess.on('close', code => {
      if (!manualStop && code !== 0 && code !== null) {
        addLog(`Servidor encerrado inesperadamente (código ${code}). Reiniciando em 3s...`, 'error');
        setTimeout(startServer, 3000);
      }
      manualStop    = false;
      serverProcess = null;
    });
  }, 600);
}

function stopServer() {
  if (serverProcess) {
    manualStop = true;
    const pid  = serverProcess.pid;
    serverProcess = null;
    killTree(pid);
    addLog('Servidor parado.', 'warn');
  }
}

// SSE — stream de logs
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  logs.forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  clients.push(res);
  req.on('close', () => clients.splice(clients.indexOf(res), 1));
});

app.get('/status',  (req, res) => res.json({ status: getStatus() }));
app.post('/start',  (req, res) => { startServer(); res.json({ ok: true }); });
app.post('/stop',   (req, res) => { stopServer();  res.json({ ok: true }); });
app.post('/restart',(req, res) => { stopServer(); setTimeout(startServer, 800); res.json({ ok: true }); });

app.get('/logs', (req, res) => res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Terminal — Matteus-Sub</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;background:#0a0a0c;color:#d4d4d8;font-family:'Consolas','Courier New',monospace;font-size:13px}
  #toolbar{position:fixed;top:0;left:0;right:0;height:40px;background:#111116;border-bottom:1px solid #222;display:flex;align-items:center;gap:8px;padding:0 12px;z-index:10}
  #toolbar a{color:#3b82f6;text-decoration:none;font-size:12px;margin-right:4px}
  #search{flex:1;max-width:300px;background:#1a1a22;border:1px solid #333;border-radius:4px;color:#d4d4d8;padding:4px 8px;font-size:12px;font-family:inherit;outline:none}
  #count{font-size:11px;color:#555;min-width:80px}
  .tbtn{background:#1a1a22;border:1px solid #333;border-radius:4px;color:#aaa;padding:4px 10px;font-size:11px;cursor:pointer;font-family:inherit}
  #terminal{position:absolute;top:40px;left:0;right:0;bottom:0;overflow-y:auto;padding:8px 12px}
  .row{display:flex;gap:0;line-height:1.65;padding:1px 0;border-bottom:1px solid #0f0f11}
  .row:hover{background:#111116}
  .row.hidden{display:none}
  .ts{color:#3a3a4a;min-width:72px;user-select:none;flex-shrink:0}
  .msg{word-break:break-all;flex:1}
  .row.info .msg{color:#d4d4d8}
  .row.success .msg{color:#4ade80}
  .row.error .msg{color:#f87171}
  .row.warn .msg{color:#fbbf24}
</style>
</head>
<body>
<div id="toolbar">
  <a href="/">← painel</a>
  <input id="search" placeholder="🔍 filtrar..." oninput="filtrar()"/>
  <span id="count"></span>
  <button class="tbtn" onclick="limpar()">limpar</button>
  <label style="font-size:11px;color:#aaa;display:flex;align-items:center;gap:4px;cursor:pointer">
    <input type="checkbox" id="as" checked> auto-scroll
  </label>
</div>
<div id="terminal"></div>
<script>
  let rows=[];let filtro='';
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function append(e){
    const t=document.getElementById('terminal');
    const d=document.createElement('div');
    d.className='row '+e.type;d.dataset.text=e.text.toLowerCase();
    d.innerHTML='<span class="ts">'+e.time+'</span><span class="msg">'+esc(e.text)+'</span>';
    rows.push(d);t.appendChild(d);applyFilter(d);
    if(document.getElementById('as').checked)t.scrollTop=t.scrollHeight;
    count();
  }
  function applyFilter(d){(!filtro||d.dataset.text.includes(filtro))?d.classList.remove('hidden'):d.classList.add('hidden');}
  function filtrar(){filtro=document.getElementById('search').value.toLowerCase();rows.forEach(applyFilter);count();}
  function count(){var v=rows.filter(r=>!r.classList.contains('hidden')).length;document.getElementById('count').textContent=v+'/'+rows.length+' linhas';}
  function limpar(){rows=[];document.getElementById('terminal').innerHTML='';count();}
  new EventSource('/events').onmessage=e=>append(JSON.parse(e.data));
</script>
</body>
</html>`));

app.get('/', (req, res) => res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gerenciador — Matteus-Sub</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f13;color:#e0e0e0;font-family:'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:40px 20px}
  h1{font-size:1.5rem;font-weight:600;margin-bottom:8px;color:#fff}
  .subtitle{color:#666;font-size:.85rem;margin-bottom:36px}
  .card{background:#1a1a22;border:1px solid #2a2a36;border-radius:16px;padding:28px 32px;width:100%;max-width:520px}
  .status-row{display:flex;align-items:center;gap:12px;margin-bottom:28px}
  .dot{width:12px;height:12px;border-radius:50%;background:#444;transition:background .4s;flex-shrink:0}
  .dot.online{background:#22c55e;box-shadow:0 0 8px #22c55e88}
  .dot.offline{background:#ef4444;box-shadow:0 0 8px #ef444488}
  .status-label{font-size:1rem;font-weight:500}
  .status-label span{color:#aaa;font-weight:400;font-size:.85rem;margin-left:6px}
  .btns{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
  button{flex:1;min-width:120px;padding:12px 16px;border:none;border-radius:10px;font-size:.9rem;font-weight:600;cursor:pointer;transition:opacity .2s,transform .1s}
  button:active{transform:scale(.97)}
  button:disabled{opacity:.35;cursor:not-allowed}
  .btn-start{background:#22c55e;color:#000}
  .btn-stop{background:#ef4444;color:#fff}
  .btn-restart{background:#f59e0b;color:#000}
  .btn-open{background:#3b82f6;color:#fff;width:100%;margin-bottom:8px;min-width:unset}
  .btn-logs{background:none;border:1px solid #2a2a36;color:#666;width:100%;margin-bottom:12px;min-width:unset;font-size:.8rem;padding:8px}
  .btn-logs:hover{color:#aaa;border-color:#444}
  .log-box{background:#0d0d10;border:1px solid #222;border-radius:10px;padding:14px;height:240px;overflow-y:auto;font-family:'Consolas',monospace;font-size:.78rem;line-height:1.6}
  .log-box::-webkit-scrollbar{width:4px}
  .log-box::-webkit-scrollbar-thumb{background:#333;border-radius:4px}
  .log-entry{padding:1px 0}
  .log-entry .t{color:#555;margin-right:6px}
  .log-entry.info .msg{color:#c8c8d4}
  .log-entry.success .msg{color:#22c55e}
  .log-entry.error .msg{color:#f87171}
  .log-entry.warn .msg{color:#fbbf24}
  .log-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .log-title{font-size:.8rem;color:#555;text-transform:uppercase;letter-spacing:1px}
  .clear-btn{background:none;border:none;color:#444;font-size:.75rem;cursor:pointer;padding:2px 6px;border-radius:4px;min-width:auto;flex:none}
  .clear-btn:hover{color:#888;background:#1a1a22}
</style>
</head>
<body>
<h1>📋 Matteus-Sub</h1>
<p class="subtitle">Gerenciador do servidor local — porta ${APP_PORT}</p>
<div class="card">
  <div class="status-row">
    <div class="dot" id="dot"></div>
    <div class="status-label" id="lbl">Verificando… <span id="sub"></span></div>
  </div>
  <div class="btns">
    <button class="btn-start"   id="s" onclick="act('start')">Iniciar</button>
    <button class="btn-stop"    id="p" onclick="act('stop')">Parar</button>
    <button class="btn-restart" id="r" onclick="act('restart')">Reiniciar</button>
  </div>
  <button class="btn-open" id="o" onclick="window.open('http://localhost:${APP_PORT}','_blank')" disabled>Abrir App</button>
  <button class="btn-logs" onclick="window.open('/logs','_blank')">Ver logs completos</button>
  <div class="log-header">
    <span class="log-title">Logs</span>
    <button class="clear-btn" onclick="document.getElementById('lb').innerHTML=''">limpar</button>
  </div>
  <div class="log-box" id="lb"></div>
</div>
<script>
  function setStatus(s){
    var d=document.getElementById('dot'),l=document.getElementById('lbl'),sb=document.getElementById('sub'),o=document.getElementById('o');
    d.className='dot '+s;
    l.childNodes[0].textContent=s==='online'?'Online ':'Offline ';
    sb.textContent=s==='online'?'— localhost:${APP_PORT}':'';
    document.getElementById('s').disabled=s==='online';
    document.getElementById('p').disabled=s==='offline';
    document.getElementById('r').disabled=s==='offline';
    o.disabled=s==='offline';
  }
  async function act(cmd){await fetch('/'+cmd,{method:'POST'});setTimeout(poll,900);}
  async function poll(){try{var r=await fetch('/status');var d=await r.json();setStatus(d.status);}catch{}}
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function appendLog(e){
    var b=document.getElementById('lb');
    var d=document.createElement('div');
    d.className='log-entry '+e.type;
    d.innerHTML='<span class="t">'+e.time+'</span><span class="msg">'+esc(e.text)+'</span>';
    b.appendChild(d);b.scrollTop=b.scrollHeight;
  }
  new EventSource('/events').onmessage=e=>appendLog(JSON.parse(e.data));
  poll();setInterval(poll,3000);setStatus('offline');
</script>
</body>
</html>`));

app.listen(MANAGER_PORT, () => {
  console.log(`Gerenciador Matteus-Sub -> http://localhost:${MANAGER_PORT}`);
  startServer();
});
