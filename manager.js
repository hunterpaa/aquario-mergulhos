const express = require('express');
const { spawn, execSync } = require('child_process');

const app = express();
app.use(express.json());

let serverProcess = null;
let manualStop = false;
let logs = [];
const MAX_LOGS = 500;
const clients = [];

function addLog(text, type = 'info') {
  const entry = { text, type, time: new Date().toLocaleTimeString('pt-BR') };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  clients.forEach(res => res.write(`data: ${JSON.stringify(entry)}\n\n`));
}

function getStatus() {
  return serverProcess && !serverProcess.killed ? 'online' : 'offline';
}

function freePort3003() {
  try {
    execSync('for /f "tokens=5" %a in (\'netstat -aon ^| findstr " :3003 "\') do taskkill /F /PID %a', { shell: 'cmd.exe', stdio: 'ignore' });
  } catch {}
}

function killTree(pid) {
  try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
}

function startServer() {
  if (getStatus() === 'online') return;
  addLog('Liberando porta 3003...', 'info');
  freePort3003();
  setTimeout(() => {
    serverProcess = spawn('node', ['server/server.js'], {
      cwd: __dirname,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '3003' },
    });
    addLog('Iniciando servidor do aquário...', 'info');
    serverProcess.stdout.on('data', d => {
      const msg = d.toString().trim();
      if (msg) addLog(msg, 'success');
    });
    serverProcess.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (!msg) return;
      if (msg.includes('EADDRINUSE')) {
        addLog('Erro: porta 3003 ainda em uso. Tente reiniciar o gerenciador.', 'error');
      } else {
        addLog(msg, 'error');
      }
    });
    serverProcess.on('error', err => {
      addLog('Falha ao iniciar: ' + err.message, 'error');
      serverProcess = null;
    });
    serverProcess.on('close', code => {
      if (!manualStop && code !== 0 && code !== null)
        addLog(`Servidor encerrado inesperadamente (código ${code}).`, 'error');
      manualStop = false;
      serverProcess = null;
    });
  }, 600);
}

function stopServer() {
  if (serverProcess) {
    manualStop = true;
    const pid = serverProcess.pid;
    serverProcess = null;
    killTree(pid);
    addLog('Servidor parado.', 'warn');
  }
}

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  logs.forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  clients.push(res);
  req.on('close', () => clients.splice(clients.indexOf(res), 1));
});

app.get('/status', (req, res) => res.json({ status: getStatus() }));
app.post('/start',   (req, res) => { startServer(); res.json({ ok: true }); });
app.post('/stop',    (req, res) => { stopServer();  res.json({ ok: true }); });
app.post('/restart', (req, res) => { stopServer(); setTimeout(startServer, 800); res.json({ ok: true }); });

app.get('/', (req, res) => res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gerenciador — Aquário</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:     #07111f;
    --bg2:    #0c1a2e;
    --bg3:    #102038;
    --card:   #0f1e35;
    --card2:  #152540;
    --border: rgba(80,140,220,.13);
    --border2:rgba(80,140,220,.22);
    --txt:    #dce8f8;
    --txt2:   #7a9cc0;
    --txt3:   #3d6080;
    --neon:   #00e676;
    --blue:   #4fc3f7;
    --red:    #ef5350;
    --yellow: #ffb300;
  }

  body {
    font-family: 'Inter', sans-serif;
    background: var(--bg);
    color: var(--txt);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .logo-icon { font-size: 1.6rem; }
  h1 {
    font-size: 1.4rem;
    font-weight: 800;
    color: var(--neon);
    letter-spacing: -.3px;
  }
  .subtitle {
    color: var(--txt3);
    font-size: .85rem;
    margin-bottom: 36px;
  }

  .card {
    background: var(--card);
    border: 1px solid var(--border2);
    border-radius: 16px;
    padding: 28px 32px;
    width: 100%;
    max-width: 520px;
    box-shadow: 0 4px 32px rgba(0,0,0,.5);
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 28px;
    padding: 14px 18px;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 10px;
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--txt3);
    transition: background .4s, box-shadow .4s;
    flex-shrink: 0;
  }
  .dot.online  { background: var(--neon); box-shadow: 0 0 10px #00e67688; }
  .dot.offline { background: var(--red);  box-shadow: 0 0 8px #ef535088; }
  .status-label { font-size: .95rem; font-weight: 600; color: var(--txt); }
  .status-sub   { color: var(--txt2); font-weight: 400; font-size: .82rem; margin-left: 6px; }

  .btns { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  button {
    flex: 1;
    min-width: 120px;
    padding: 11px 16px;
    border: none;
    border-radius: 10px;
    font-family: 'Inter', sans-serif;
    font-size: .88rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity .2s, transform .1s, box-shadow .2s;
  }
  button:active { transform: scale(.97); }
  button:disabled { opacity: .3; cursor: not-allowed; }

  .btn-start   { background: var(--neon); color: #071a0d; }
  .btn-start:not(:disabled):hover   { box-shadow: 0 0 16px #00e67666; }
  .btn-stop    { background: var(--red);  color: #fff; }
  .btn-stop:not(:disabled):hover    { box-shadow: 0 0 16px #ef535066; }
  .btn-restart { background: var(--yellow); color: #1a1000; }
  .btn-restart:not(:disabled):hover { box-shadow: 0 0 16px #ffb30066; }

  .btn-open {
    background: linear-gradient(135deg, #1565c0, #0277bd);
    color: #fff;
    width: 100%;
    margin-bottom: 16px;
    min-width: unset;
    border: 1px solid rgba(79,195,247,.2);
  }
  .btn-open:not(:disabled):hover { box-shadow: 0 0 18px rgba(79,195,247,.3); }

  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .log-title { font-size: .75rem; color: var(--txt3); text-transform: uppercase; letter-spacing: 1px; }
  .clear-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--txt3);
    font-size: .72rem;
    cursor: pointer;
    padding: 3px 8px;
    border-radius: 6px;
    min-width: auto;
    flex: none;
    font-family: 'Inter', sans-serif;
  }
  .clear-btn:hover { color: var(--txt2); border-color: var(--border2); }

  .log-box {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    height: 280px;
    overflow-y: auto;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: .78rem;
    line-height: 1.65;
  }
  .log-box::-webkit-scrollbar { width: 4px; }
  .log-box::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 4px; }

  .log-entry { padding: 1px 0; border-bottom: 1px solid rgba(80,140,220,.04); }
  .log-entry .t   { color: var(--txt3); margin-right: 8px; }
  .log-entry.info    .msg { color: var(--txt2); }
  .log-entry.success .msg { color: var(--neon); }
  .log-entry.error   .msg { color: var(--red); }
  .log-entry.warn    .msg { color: var(--yellow); }
</style>
</head>
<body>

<header>
  <span class="logo-icon">🤿</span>
  <h1>Aquário — Gerenciador</h1>
</header>
<p class="subtitle">Controle do servidor de mergulhos</p>

<div class="card">
  <div class="status-row">
    <div class="dot" id="dot"></div>
    <div class="status-label" id="statusLabel">
      Verificando…<span class="status-sub" id="statusSub"></span>
    </div>
  </div>

  <div class="btns">
    <button class="btn-start"   id="btnStart"   onclick="action('start')">▶ Iniciar</button>
    <button class="btn-stop"    id="btnStop"    onclick="action('stop')">■ Parar</button>
    <button class="btn-restart" id="btnRestart" onclick="action('restart')">↺ Reiniciar</button>
  </div>

  <button class="btn-open" id="btnOpen" onclick="window.open('http://localhost:3003','_blank')" disabled>
    🌊 Abrir App do Aquário
  </button>

  <div class="log-header">
    <span class="log-title">Logs do servidor</span>
    <button class="clear-btn" onclick="clearLogs()">limpar</button>
  </div>
  <div class="log-box" id="logBox"></div>
</div>

<script>
  function setStatus(s) {
    const dot   = document.getElementById('dot');
    const label = document.getElementById('statusLabel');
    const sub   = document.getElementById('statusSub');
    dot.className = 'dot ' + s;
    if (s === 'online') {
      label.childNodes[0].textContent = 'Online ';
      sub.textContent = '— localhost:3003';
    } else {
      label.childNodes[0].textContent = 'Offline ';
      sub.textContent = '';
    }
    document.getElementById('btnStart').disabled   = s === 'online';
    document.getElementById('btnStop').disabled    = s === 'offline';
    document.getElementById('btnRestart').disabled = s === 'offline';
    document.getElementById('btnOpen').disabled    = s === 'offline';
  }

  async function action(cmd) {
    await fetch('/' + cmd, { method: 'POST' });
    setTimeout(pollStatus, 1000);
  }

  async function pollStatus() {
    try {
      const r = await fetch('/status');
      const d = await r.json();
      setStatus(d.status);
    } catch {}
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function appendLog(e) {
    const box = document.getElementById('logBox');
    const div = document.createElement('div');
    div.className = 'log-entry ' + e.type;
    div.innerHTML = '<span class="t">' + e.time + '</span><span class="msg">' + escHtml(e.text) + '</span>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function clearLogs() {
    document.getElementById('logBox').innerHTML = '';
  }

  const es = new EventSource('/events');
  es.onmessage = e => appendLog(JSON.parse(e.data));

  setStatus('offline');
  pollStatus();
  setInterval(pollStatus, 3000);
</script>
</body>
</html>`));

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`Gerenciador rodando em http://localhost:${PORT}`);
  startServer();
});
