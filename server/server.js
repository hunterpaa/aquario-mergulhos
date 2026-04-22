// server.js — Tanaka-Sub v3
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { google } = require('googleapis');

const app  = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ========== GERENCIADOR MATTEUS-SUB ==========
// Endpoint para o Manager (health check + controle)
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Endpoint para comandos do manager (opcional)
app.post('/manager/:action', (req, res) => {
    const { action } = req.params;
    console.log(`📡 Comando recebido do manager: ${action}`);
    res.json({ status: 'ok', action: action });
});

// Stream de logs em tempo real (via Server-Sent Events)
app.get('/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    res.write('retry: 10000\n\n');
    res.write(`data: 🎮 Stream de logs conectado em ${new Date().toLocaleString()}\n\n`);
    
    // Mantém conexão aberta
    const interval = setInterval(() => {
        res.write(`data: 💓 Heartbeat - Servidor ativo\n\n`);
    }, 30000);
    
    req.on('close', () => {
        clearInterval(interval);
        console.log('📡 Cliente desconectou do stream de logs');
    });
});
// ========== FIM GERENCIADOR ==========
// ─── AUTH ──────────────────────────────────────────────────────────────────────
function getAuth() {
  if (process.env.GOOGLE_CREDENTIALS) {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'google-key.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

const SHEET_ID  = process.env.SPREADSHEET_ID || '16y-AmjOYbgUON0FzWzxxJFlyZOzTHa6S8ieeZ0EVVJI';
const ABA_REG   = 'Registros';
const ABA_OP    = 'Operação'; // usado SOMENTE na rota /api/migrar

const CABECALHO = ['ID','Data','Mergulhador','Aquário/Tanque','Sistema',
                   'Serviço','Hora_Entrada','Hora_Saída','Tempo_Total_Min',
                   'Status','Motivo_Pausa'];

// ─── CONSTANTES ────────────────────────────────────────────────────────────────
const SISTEMAS = {
  A:[1,2,3,4,5], B:[6,7,8], C:[9], D:[10,11,12], E:[13,14,15,16,17], F:[18,19,20,21,22]
};
const CRONOGRAMA = { 1:['C','E'], 2:['A'], 3:['B'], 4:['D'], 5:['F'] };
const META_HORAS = 120;
const CICLO_H    = 60;

// ─── NORMALIZAÇÃO DE NOMES ─────────────────────────────────────────────────────
// Corrige variações antigas ("Matteu", "matteus", etc.) para o nome canônico
const NOMES_CANONICOS = {
  matteu:    'Matteus',
  matteus:   'Matteus',
  leonardo:  'Leonardo',
  kelvin:    'Kelvin',
  danilo:    'Danilo',
};
function normNome(n) {
  if (!n) return '';
  return NOMES_CANONICOS[n.trim().toLowerCase()] || n.trim();
}

// ─── HELPERS SHEETS ────────────────────────────────────────────────────────────
function sh() { return google.sheets({ version:'v4', auth: getAuth() }); }

async function lerRange(range) {
  const r = await sh().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  return r.data.values || [];
}

async function garantirAba() {
  const meta = await sh().spreadsheets.get({ spreadsheetId: SHEET_ID });
  const abas = meta.data.sheets.map(s => s.properties.title);
  if (abas.includes(ABA_REG)) return;

  await sh().spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: ABA_REG } } }] },
  });
  await sh().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${ABA_REG}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [CABECALHO] },
  });
  console.log(`Aba "${ABA_REG}" criada.`);
}

function linhaObj(l) {
  return {
    id:          l[0]||'',
    data:        l[1]||'',
    mergulhador: normNome(l[2]),     // normaliza na leitura
    aquario:     l[3]||'',
    sistema:     l[4]||'',
    servico:     l[5]||'',
    horaEntrada: l[6]||'',
    horaSaida:   l[7]||'',
    minutos:     Number(l[8])||0,
    status:      l[9]||'Mergulho',
    motivoPausa: l[10]||'',
  };
}

async function lerReg() {
  const linhas = await lerRange(`'${ABA_REG}'!A2:K`);
  return linhas.map(linhaObj);
}

function calcMin(e, s) {
  if (!e||!s) return 0;
  const [hE,mE]=e.split(':').map(Number);
  const [hS,mS]=s.split(':').map(Number);
  return Math.max(0,(hS*60+mS)-(hE*60+mE));
}

function dataLonga(str) {
  if (!str) return '';
  const p = str.split('/');
  if (p.length < 3) return str;
  const dt = new Date(Number(p[2]), Number(p[1])-1, Number(p[0]));
  return dt.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
}

// ─── CÁLCULOS DE TEMPO ─────────────────────────────────────────────────────────

// Dias úteis decorridos no mês atual até hoje (para calcular média real)
function diasUteisDecorridos() {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  let d = new Date(inicio), n = 0;
  while (d <= hoje) {
    if (d.getDay()!==0 && d.getDay()!==6) n++;
    d.setDate(d.getDate()+1);
  }
  return Math.max(1, n);
}

// Dias úteis restantes no mês atual (inclusive hoje) → prazo para bater as 60h
function diasUteisRestantesMes() {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const ultimo = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0);
  let d = new Date(hoje), n = 0;
  while (d <= ultimo) {
    if (d.getDay()!==0 && d.getDay()!==6) n++;
    d.setDate(d.getDate()+1);
  }
  return { dias: Math.max(1, n), prazo: ultimo.toLocaleDateString('pt-BR') };
}

// ─── DEBUG ─────────────────────────────────────────────────────────────────────
app.get('/api/debug/abas', async (req, res) => {
  try {
    const meta = await sh().spreadsheets.get({ spreadsheetId: SHEET_ID });
    res.json({ abas: meta.data.sheets.map(s => s.properties.title), id: SHEET_ID });
  } catch (err) {
    res.status(500).json({ erro: err.message.includes('403')
      ? 'Acesso negado. Compartilhe a planilha com a Service Account como Editor.'
      : err.message });
  }
});

// ─── MIGRAÇÃO (somente rota que ainda usa Operação) ───────────────────────────
app.get('/api/migrar/preview', async (req, res) => {
  try {
    const linhas = await lerRange(`'${ABA_OP}'!A1:L20`);
    res.json({ cabecalho: linhas[0], linhas14a20: linhas.slice(13), total: linhas.length });
  } catch (err) { res.status(500).json({ erro: err.message }); }
});

app.post('/api/migrar/executar', async (req, res) => {
  try {
    await garantirAba();
    const linhasOp = await lerRange(`'${ABA_OP}'!A15:L`);
    if (!linhasOp.length) return res.json({ sucesso:true, migrados:0 });

    const [cab] = await lerRange(`'${ABA_OP}'!A1:L1`);
    const idx = nome => cab ? cab.findIndex(c=>c?.toLowerCase().includes(nome)) : -1;

    const iData=idx('data')>=0?idx('data'):1, iMerg=idx('merg')>=0?idx('merg'):2;
    const iAq=idx('aquár')>=0?idx('aquár'):idx('tanq')>=0?idx('tanq'):3;
    const iSis=idx('sist')>=0?idx('sist'):4, iServ=idx('serv')>=0?idx('serv'):5;
    const iE=idx('entr')>=0?idx('entr'):6, iS=idx('saí')>=0?idx('saí'):idx('sai')>=0?idx('sai'):7;
    const iMin=idx('min')>=0?idx('min'):idx('temp')>=0?idx('temp'):8;

    const existentes = await lerReg();
    let proxId = existentes.length+1;

    const novas = linhasOp
      .filter(l => l.some(c=>c?.toString().trim()))
      .map(l => {
        const e=l[iE]||'', s=l[iS]||'';
        const min=l[iMin]?(Number(l[iMin])||calcMin(e,s)):calcMin(e,s);
        return [String(proxId++).padStart(4,'0'), l[iData]||'',
                normNome(l[iMerg]), l[iAq]||'', l[iSis]||'', l[iServ]||'',
                e, s, min, 'Mergulho', ''];
      });

    if (!novas.length) return res.json({ sucesso:true, migrados:0 });
    await sh().spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range:`'${ABA_REG}'!A1`,
      valueInputOption:'RAW', requestBody:{ values:novas },
    });
    res.json({ sucesso:true, migrados:novas.length, amostra:novas[0] });
  } catch (err) { res.status(500).json({ erro:err.message }); }
});

// ─── REGISTROS ─────────────────────────────────────────────────────────────────
app.get('/api/registros', async (req, res) => {
  try {
    await garantirAba();
    const todos = await lerReg();
    res.json(todos.map(r=>({...r, dataLonga:dataLonga(r.data)})));
  } catch (err) { res.status(500).json({ erro:err.message }); }
});

app.post('/api/registros', async (req, res) => {
  try {
    await garantirAba();
    const todos = await lerReg();
    const { aquario, sistema, servico, horaEntrada, horaSaida,
            observacoes, motivoPausa, status='Mergulho' } = req.body;
    const mergulhador = normNome(req.body.mergulhador);
    const data   = req.body.data || new Date().toLocaleDateString('pt-BR');
    const minutos = status==='Sem Mergulho' ? 0 : calcMin(horaEntrada, horaSaida);
    const id = String(todos.length+1).padStart(4,'0');

    await sh().spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range:`'${ABA_REG}'!A1`,
      valueInputOption:'RAW',
      requestBody:{ values:[[id,data,mergulhador,String(aquario||''),sistema||'',servico||'',
                             horaEntrada||'',horaSaida||'',minutos,status,
                             motivoPausa||observacoes||'']] },
    });
    res.json({ sucesso:true, id, minutos });
  } catch (err) { res.status(500).json({ erro:err.message }); }
});

app.post('/api/registros/lote', async (req, res) => {
  try {
    await garantirAba();
    const todos = await lerReg();
    const lote  = req.body.registros;
    if (!Array.isArray(lote)||!lote.length) return res.status(400).json({ erro:'Array vazio.' });

    const linhas = lote.map((r,i)=>{
      const min = r.minutos ?? calcMin(r.horaEntrada, r.horaSaida);
      const dt  = r.data || new Date().toLocaleDateString('pt-BR');
      return [String(todos.length+i+1).padStart(4,'0'), dt, normNome(r.mergulhador),
              String(r.aquario), r.sistema, r.servico, r.horaEntrada||'',
              r.horaSaida||'', min, r.status||'Mergulho', r.motivoPausa||''];
    });

    await sh().spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range:`'${ABA_REG}'!A1`,
      valueInputOption:'RAW', requestBody:{ values:linhas },
    });
    res.json({ sucesso:true, quantidade:linhas.length });
  } catch (err) { res.status(500).json({ erro:err.message }); }
});

// ─── DASHBOARD ─────────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    await garantirAba();
    const todos     = await lerReg();
    const mergulhos = todos.filter(r => r.status !== 'Sem Mergulho');
    const pausas    = todos.filter(r => r.status === 'Sem Mergulho');

    const totalMin   = mergulhos.reduce((a,r)=>a+r.minutos, 0);
    const totalHoras = +(totalMin/60).toFixed(2);

    // Progresso no ciclo atual (0 → 60h)
    const horasNoCiclo  = +(totalHoras % CICLO_H).toFixed(2);
    const pctCiclo      = +((horasNoCiclo/CICLO_H)*100).toFixed(1);
    const cicloAtual    = Math.floor(totalHoras/CICLO_H)+1;

    // Média de horas por dia útil (mês atual)
    const diasDecorridos = diasUteisDecorridos();
    const mediaHorasDia  = +(totalHoras / diasDecorridos).toFixed(2);

    // Estimativa: prazo = último dia do mês atual
    const { dias:diasRestantes, prazo } = diasUteisRestantesMes();
    const hParaProx60   = +(CICLO_H - horasNoCiclo).toFixed(2);
    const hPorDiaNecc   = +(hParaProx60 / diasRestantes).toFixed(2);

    // Horas por mergulhador (com nomes normalizados)
    const hPorMerg = { Leonardo:0, Kelvin:0, Danilo:0, Matteus:0 };
    mergulhos.forEach(r => {
      if (r.mergulhador in hPorMerg)
        hPorMerg[r.mergulhador] = +(hPorMerg[r.mergulhador]+r.minutos/60).toFixed(2);
    });

    // Horas por sistema
    const hPorSis={}, minSis={}, cntSis={};
    mergulhos.forEach(r => {
      if (!r.sistema) return;
      minSis[r.sistema]=(minSis[r.sistema]||0)+r.minutos;
      cntSis[r.sistema]=(cntSis[r.sistema]||0)+1;
    });
    Object.keys(minSis).forEach(s=>{
      hPorSis[s]=+(minSis[s]/60).toFixed(2);
    });
    const mediaSis={};
    Object.keys(minSis).forEach(s=>{
      mediaSis[s]=+(minSis[s]/cntSis[s]).toFixed(1);
    });

    const dia = new Date().getDay();
    res.json({
      // 3 indicadores principais
      totalHoras,
      horasNoCiclo,
      pctCiclo,
      cicloAtual,
      mediaHorasDia,
      // estimativa
      estimativa: { prazo, diasRestantes, hParaProx60, hPorDiaNecc },
      // extras
      totalMergulhos: mergulhos.length,
      diasSemMergulho: pausas.length,
      metaHoras: META_HORAS,
      horasPorMergulhador: hPorMerg,
      horasPorSistema: hPorSis,
      mediaSistema: mediaSis,
      sistemasHoje: CRONOGRAMA[dia]||[],
      ultimos10: todos.slice(-10).reverse().map(r=>({...r,dataLonga:dataLonga(r.data)})),
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ erro:err.message });
  }
});

app.get('/api/sistemas', (req,res) => {
  res.json({ sistemas:SISTEMAS, cronograma:CRONOGRAMA, sistemasHoje:CRONOGRAMA[new Date().getDay()]||[] });
});

app.get('*', (req,res) => {
  res.sendFile(path.join(__dirname,'../public/index.html'));
});

// ─── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🤿  Tanaka-Sub v3 → http://localhost:${PORT}`);
  console.log(`📊  ${SHEET_ID}`);
  console.log(`🔑  ${path.join(__dirname,'google-key.json')}\n`);
});
