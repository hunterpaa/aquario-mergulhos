const express = require('express');
const { spawn, execSync } = require('child_process');

const app = express();
app.use(express.json());

let serverProcess = null;
let manualStop = false;
let logs = [];
const MAX_LOGS = 500;
const clients = [];
const clientsFull = [];

const DETAIL_PREFIXES = ['[MATÉRIA]', '[MATÉRIAS]', '[UPLOAD]', '[COOKIE]'];

function isDetail(text) {
  return DETAIL_PREFIXES.some(p => text.startsWith(p));
}

function addLog(text, type = 'info') {
  const detail = isDetail(text);
  const entry = { text, type, time: new Date().toLocaleTimeString('pt-BR'), detail };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  clientsFull.forEach(res => res.write(`data: ${JSON.stringify(entry)}\n\n`));
  if (!detail) clients.forEach(res => res.write(`data: ${JSON.stringify(entry)}\n\n`));
}

function getStatus() {
  return serverProcess && !serverProcess.killed ? 'online' : 'offline';
}

function freePort3000() {
  try {
    execSync('for /f "tokens=5" %a in (\'netstat -aon ^| findstr " :3000 "\') do taskkill /F /PID %a', { shell: 'cmd.exe', stdio: 'ignore' });
  } catch {}
}

function killTree(pid) {
  try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch {}
}

function startServer() {
  if (getStatus() === 'online') return;
  addLog('Liberando porta 3000...', 'info');
  freePort3000();
  setTimeout(() => {
    serverProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    addLog('Iniciando servidor...', 'info');
    serverProcess.stdout.on('data', d => {
      const msg = d.toString().trim();
      if (msg) addLog(msg, 'success');
    });
    serverProcess.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (!msg) return;
      if (msg.includes('EADDRINUSE')) {
        addLog('Erro: porta 3000 ainda em uso. Tente reiniciar o gerenciador.', 'error');
      } else {
        addLog(msg, 'error');
      }
    });
    serverProcess.on('error', err => {
      addLog('Falha ao iniciar: ' + err.message, 'error');
      serverProcess = null;
    });
    serverProcess.on('close', code => {
      if (!manualStop && code !== 0 && code !== null) addLog(`Servidor encerrado inesperadamente (código ${code}).`, 'error');
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

// SSE — logs resumidos (sem detalhes)
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  logs.filter(e => !e.detail).forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  clients.push(res);
  req.on('close', () => clients.splice(clients.indexOf(res), 1));
});

// SSE — logs completos
app.get('/events-full', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  logs.forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`));
  clientsFull.push(res);
  req.on('close', () => clientsFull.splice(clientsFull.indexOf(res), 1));
});

// Página de logs completos
app.get('/logs', (req, res) => res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Logs completos - Matteus Sub</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at 20% 50%, #0a0f1e, #06090f); color: #c0e0ff; font-family: 'Consolas', monospace; font-size: .8rem; padding: 20px; }
  h2 { color: #00e6ff; font-family: 'Segoe UI', sans-serif; font-size: 1rem; margin-bottom: 14px; text-shadow: 0 0 5px #00e6ff50; }
  a { color: #00e6ff; text-decoration: none; }
  a:hover { text-shadow: 0 0 5px #00e6ff; }
  .log-entry { line-height: 1.7; border-bottom: 1px solid #00e6ff10; padding: 2px 0; }
  .t { color: #00e6ff; margin-right: 8px; }
  .info    .msg { color: #c0e0ff; }
  .success .msg { color: #22ff88; }
  .error   .msg { color: #ff6666; }
  .warn    .msg { color: #ffaa44; }
  .detail  .msg { color: #8888ff; }
  #box { height: calc(100vh - 60px); overflow-y: auto; }
  #box::-webkit-scrollbar { width: 6px; }
  #box::-webkit-scrollbar-track { background: #001a2a; }
  #box::-webkit-scrollbar-thumb { background: #00e6ff; border-radius: 4px; }
</style>
</head>
<body>
<h2>📋 Logs completos — <a href="/" style="color:#00e6ff">← voltar ao painel</a></h2>
<div id="box"></div>
<script>
  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function appendLog(e) {
    const box = document.getElementById('box');
    const div = document.createElement('div');
    div.className = 'log-entry ' + e.type + (e.detail ? ' detail' : '');
    div.innerHTML = '<span class="t">' + e.time + '</span><span class="msg">' + escHtml(e.text) + '</span>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
  const es = new EventSource('/events-full');
  es.onmessage = e => appendLog(JSON.parse(e.data));
</script>
</body>
</html>`));

app.get('/status', (req, res) => res.json({ status: getStatus() }));

app.post('/start',   (req, res) => { startServer(); res.json({ ok: true }); });
app.post('/stop',    (req, res) => { stopServer();  res.json({ ok: true }); });
app.post('/restart', (req, res) => { stopServer(); setTimeout(startServer, 800); res.json({ ok: true }); });

app.get('/', (req, res) => res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Painel da Duda - Matteus Sub</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: radial-gradient(circle at 20% 50%, #0a0f1e, #06090f);
    font-family: 'Segoe UI', 'Poppins', sans-serif;
    min-height: 100vh;
    padding: 40px 20px;
    position: relative;
  }

  /* Grade futurista */
  body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image: linear-gradient(#00e6ff08 1px, transparent 1px),
                      linear-gradient(90deg, #00e6ff08 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
    z-index: 0;
  }

  .container {
    max-width: 550px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }

  /* Header */
  .header {
    text-align: center;
    margin-bottom: 30px;
  }

  .header h1 {
    font-size: 2rem;
    background: linear-gradient(135deg, #00e6ff, #0088ff);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    margin-bottom: 8px;
    text-shadow: 0 0 20px #00e6ff40;
  }

  .subtitle {
    color: #5a7a9a;
    font-size: 0.85rem;
  }

  /* Card principal */
  .card {
    background: rgba(8, 20, 35, 0.7);
    backdrop-filter: blur(10px);
    border: 1px solid #00e6ff30;
    border-radius: 24px;
    padding: 32px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  /* Status */
  .status-row {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(0, 230, 255, 0.05);
    padding: 12px 16px;
    border-radius: 16px;
    margin-bottom: 28px;
  }

  .led {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    transition: all 0.3s;
  }

  .led.online {
    background: #22ff88;
    box-shadow: 0 0 10px #22ff88;
    animation: pulse 1.5s infinite;
  }

  .led.offline {
    background: #ff4444;
    box-shadow: 0 0 8px #ff4444;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .status-text {
    font-size: 1.2rem;
    font-weight: 600;
    color: #e0e0e0;
  }

  .status-text span {
    color: #5a7a9a;
    font-size: 0.8rem;
    margin-left: 8px;
  }

  /* Botões */
  .btn-grid {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  button {
    flex: 1;
    min-width: 110px;
    padding: 12px 16px;
    border: none;
    border-radius: 12px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }

  button:active {
    transform: scale(0.97);
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }

  .btn-start {
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: #fff;
    box-shadow: 0 2px 8px #22c55e40;
  }

  .btn-stop {
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: #fff;
    box-shadow: 0 2px 8px #ef444440;
  }

  .btn-restart {
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: #fff;
    box-shadow: 0 2px 8px #f59e0b40;
  }

  .btn-open {
    background: linear-gradient(135deg, #00aaff, #0055dd);
    color: #fff;
    width: 100%;
    margin-bottom: 12px;
    box-shadow: 0 2px 8px #00aaff40;
  }

  .btn-logs {
    background: rgba(0, 230, 255, 0.1);
    border: 1px solid #00e6ff40;
    color: #00e6ff;
    width: 100%;
    margin-bottom: 20px;
    font-size: 0.8rem;
    padding: 10px;
  }

  .btn-logs:hover {
    background: rgba(0, 230, 255, 0.2);
    border-color: #00e6ff;
  }

  /* Logs */
  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .log-title {
    font-size: 0.75rem;
    color: #00e6ff;
    text-transform: uppercase;
    letter-spacing: 2px;
    font-weight: 600;
  }

  .clear-btn {
    background: transparent;
    border: 1px solid #ff444460;
    color: #ff8888;
    font-size: 0.7rem;
    cursor: pointer;
    padding: 4px 12px;
    border-radius: 8px;
    transition: all 0.2s;
    min-width: auto;
    flex: none;
  }

  .clear-btn:hover {
    background: #ff444420;
    border-color: #ff8888;
  }

  .log-box {
    background: rgba(2, 8, 18, 0.8);
    border: 1px solid #00e6ff20;
    border-radius: 16px;
    padding: 16px;
    height: 280px;
    overflow-y: auto;
    font-family: 'Consolas', monospace;
    font-size: 0.78rem;
    line-height: 1.6;
  }

  .log-box::-webkit-scrollbar {
    width: 6px;
  }

  .log-box::-webkit-scrollbar-track {
    background: #001a2a;
    border-radius: 3px;
  }

  .log-box::-webkit-scrollbar-thumb {
    background: #00e6ff;
    border-radius: 3px;
  }

  .log-entry {
    padding: 3px 0;
    border-bottom: 1px solid #00e6ff08;
  }

  .log-entry .time {
    color: #00e6ff;
    margin-right: 8px;
  }

  .log-entry.info .msg { color: #c0e0ff; }
  .log-entry.success .msg { color: #22ff88; }
  .log-entry.error .msg { color: #ff8888; }
  .log-entry.warn .msg { color: #ffaa66; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🐠 Painel da Duda</h1>
    <div class="subtitle">Gerenciador do servidor Matteus-Sub</div>
  </div>

  <div class="card">
    <div class="status-row">
      <div class="led" id="led"></div>
      <div class="status-text" id="statusText">Verificando... <span id="statusSub"></span></div>
    </div>

    <div class="btn-grid">
      <button class="btn-start" id="btnStart" onclick="action('start')">▶ Iniciar</button>
      <button class="btn-stop" id="btnStop" onclick="action('stop')">⏹ Parar</button>
      <button class="btn-restart" id="btnRestart" onclick="action('restart')">🔄 Reiniciar</button>
    </div>

    <button class="btn-open" id="btnOpen" onclick="window.open('http://localhost:3002/app','_blank')" disabled>🌐 Abrir App</button>
    <button class="btn-logs" onclick="window.open('/logs','_blank')">📄 Ver logs completos</button>

    <div class="log-header">
      <span class="log-title">📋 LOGS</span>
      <button class="clear-btn" onclick="clearLogs()">Limpar</button>
    </div>
    <div class="log-box" id="logBox"></div>
  </div>
</div>

<script>
  function setStatus(s) {
    const led = document.getElementById('led');
    const label = document.getElementById('statusText');
    const sub = document.getElementById('statusSub');
    
    led.className = 'led ' + s;
    
    if (s === 'online') {
      label.innerHTML = '🟢 Online <span>— porta 3002</span>';
      sub.textContent = '';
    } else {
      label.innerHTML = '🔴 Offline <span></span>';
      sub.textContent = '';
    }
    
    document.getElementById('btnStart').disabled = s === 'online';
    document.getElementById('btnStop').disabled = s === 'offline';
    document.getElementById('btnRestart').disabled = s === 'offline';
    document.getElementById('btnOpen').disabled = s === 'offline';
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
    } catch(e) {
      setStatus('offline');
    }
  }

  function appendLog(e) {
    const box = document.getElementById('logBox');
    const div = document.createElement('div');
    div.className = 'log-entry ' + e.type;
    div.innerHTML = '<span class="time">' + e.time + '</span><span class="msg">' + escHtml(e.text) + '</span>';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function clearLogs() {
    document.getElementById('logBox').innerHTML = '';
  }

  const es = new EventSource('/events');
  es.onmessage = e => appendLog(JSON.parse(e.data));

  pollStatus();
  setInterval(pollStatus, 3000);
  setStatus('offline');
</script>
</body>
</html>`));

const PORT = 3003;
app.listen(PORT, () => {
  console.log(`\n🐠 Matteus-Sub Gerenciador`);
  console.log(`📊 http://localhost:${PORT}`);
  console.log(`🎨 Tema Dark Marine aplicado!\n`);
});