const defaultParams = () => ({
  caPermeability: 0.5,
  pRelease: 0.5,
  nSynapses: 1,
  quantalResponse: 1,
});

const state = {
  sessionId: null,
  joinUrl: '',
  qrDataUrl: '',
  synapseCount: 0,
  synapses: [],
  eventSource: null,
  spikes: [],
};

const graphCanvas = document.getElementById('spike-graph');
const graphCtx = graphCanvas.getContext('2d');
const qrImg = document.getElementById('qr-img');
const palette = [
  '#5cf4d9', '#f7b538', '#8f8bff', '#ff6f61', '#6dd3ff', '#c1ff5c',
  '#ff9de2', '#7cf37c', '#ffd166', '#5ca9ff', '#f9ed69', '#9cf6f6',
];

function resizeGraph() {
  const ratio = window.devicePixelRatio || 1;
  const rect = graphCanvas.getBoundingClientRect();
  graphCanvas.width = rect.width * ratio;
  graphCanvas.height = rect.height * ratio;
  graphCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function renderQrCode(qrDataUrl, joinUrl) {
  qrImg.src = qrDataUrl || '';
  qrImg.alt = joinUrl ? `QR code to join ${joinUrl}` : 'QR code to join';
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function drawSynapse(canvas, syn, intensity = 0) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const scale = Math.min(w / 320, h / 200);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(10, 0);

  // background glow
  const glow = ctx.createRadialGradient(160, 90, 10, 160, 90, 140);
  glow.addColorStop(0, `rgba(92, 244, 217, ${0.10 + intensity * 0.25})`);
  glow.addColorStop(1, 'rgba(12, 16, 33, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 320, 220);

  // presynaptic bulb
  ctx.beginPath();
  ctx.moveTo(30, 30);
  ctx.bezierCurveTo(40, 10, 280, 10, 290, 30);
  ctx.lineTo(300, 120);
  ctx.bezierCurveTo(300, 150, 20, 150, 20, 120);
  ctx.closePath();
  const bulbFill = syn.assigned
    ? (syn.receptor === 'NMDA' ? '#4b51c6' : '#1f8a70')
    : '#1c2444';
  ctx.fillStyle = bulbFill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // mitochondria + vesicles (stylized)
  for (let i = 0; i < 5; i += 1) {
    const rx = 60 + i * 45 + (seededRandom(syn.id * 7 + i) - 0.5) * 16;
    const ry = 70 + (seededRandom(syn.id * 11 + i) - 0.5) * 24;
    const r = 12 + seededRandom(syn.id * 13 + i) * 8;
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.arc(rx, ry, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
  }

  // neurotransmitter dots (between cleft)
  for (let i = 0; i < 20; i += 1) {
    const rx = lerp(60, 260, seededRandom(syn.id * 19 + i));
    const ry = lerp(135, 165, seededRandom(syn.id * 23 + i));
    ctx.beginPath();
    ctx.fillStyle = `rgba(247, 181, 56, ${0.5 + 0.5 * intensity})`;
    ctx.arc(rx, ry, 2 + intensity * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // synaptic cleft line
  ctx.beginPath();
  ctx.moveTo(20, 140);
  ctx.quadraticCurveTo(160, 160, 300, 140);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#0b1024';
  ctx.stroke();

  // postsynaptic side
  ctx.beginPath();
  ctx.moveTo(20, 180);
  ctx.quadraticCurveTo(160, 200, 300, 180);
  ctx.lineTo(300, 215);
  ctx.quadraticCurveTo(160, 225, 20, 215);
  ctx.closePath();
  ctx.fillStyle = '#1a2d5c';
  ctx.fill();

  // receptors illustrated as channels
  const channelColor = syn.receptor === 'NMDA' ? '#8f8bff' : '#7cf37c';
  const channels = [90, 160, 230];
  channels.forEach((x, idx) => {
    const open = syn.assigned;
    ctx.save();
    ctx.translate(x, 175);
    ctx.fillStyle = open ? channelColor : 'rgba(255,255,255,0.25)';
    drawRoundedRect(ctx, -10, 0, 20, 30, 6);
    ctx.fill();
    // ion stream
    if (intensity > 0 && open) {
      ctx.strokeStyle = `rgba(92, 244, 217, ${0.4 * intensity})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 32);
      ctx.lineTo(0, 32 + intensity * 14);
      ctx.stroke();
    }
    ctx.restore();
  });

  // flash ring
  if (intensity > 0.01) {
    ctx.strokeStyle = `rgba(247, 181, 56, ${0.35 * intensity})`;
    ctx.lineWidth = 10 * intensity + 1;
    drawRoundedRect(ctx, 8, 6, 304, 208, 18);
    ctx.stroke();
  }

  ctx.restore();
}

function createSynapseCard(syn) {
  const card = document.createElement('div');
  card.className = 'synapse-card';

  const header = document.createElement('div');
  header.className = 'synapse-header';
  const label = document.createElement('div');
  label.textContent = `Synapse ${syn.id + 1}`;
  const badge = document.createElement('span');
  badge.className = 'badge unassigned';
  badge.textContent = 'unassigned';
  header.append(label, badge);

  const canvas = document.createElement('canvas');
  canvas.className = 'synapse-canvas';
  canvas.width = 320;
  canvas.height = 200;

  const params = document.createElement('div');
  params.className = 'params';
  const lines = ['caPermeability', 'pRelease', 'nSynapses', 'quantalResponse'].map((key) => {
    const row = document.createElement('div');
    row.className = 'param-line';
    const left = document.createElement('span');
    left.textContent = key === 'caPermeability'
      ? 'Ca++ perm'
      : key === 'pRelease'
        ? 'P(release)'
        : key === 'nSynapses'
          ? '# synapses'
          : 'Quantal resp';
    const right = document.createElement('span');
    right.dataset.key = key;
    row.append(left, right);
    params.appendChild(row);
    return [key, right];
  });

  card.append(header, canvas, params);

  return {
    root: card,
    canvas,
    badge,
    paramLabels: Object.fromEntries(lines),
    flashUntil: 0,
    flashPower: 0,
  };
}

function ensureSynapses(count) {
  const grid = document.getElementById('synapse-grid');
  grid.innerHTML = '';
  state.synapses = [];
  for (let i = 0; i < count; i += 1) {
    const syn = {
      id: i,
      assigned: false,
      receptor: null,
      params: defaultParams(),
    };
    syn.view = createSynapseCard(syn);
    grid.appendChild(syn.view.root);
    state.synapses.push(syn);
  }
}

function updateCounts() {
  const connected = state.synapses.filter((s) => s.assigned).length;
  document.getElementById('connected-count').textContent = `Controllers: ${connected}`;
  document.getElementById('synapse-count').textContent = `Synapses: ${state.synapseCount}`;
}

function recordSpike(spike) {
  const now = performance.now();
  const syn = state.synapses[spike.synapseId];
  const params = syn?.params || defaultParams();
  const receptor = syn?.receptor || 'AMPA';
  state.spikes.push({
    t: now,
    synapseId: spike.synapseId,
    receptor,
    power: spike.power || 1,
    params: { ...params },
  });
  const cutoff = now - 10000; // keep last 10s
  state.spikes = state.spikes.filter((s) => s.t >= cutoff);
}

function spikeValue(spike, t) {
  if (t <= 0) return 0;
  const { params, receptor, power } = spike;
  const baseAmp = power * params.quantalResponse * (0.5 + 0.5 * params.pRelease) * (1 + 0.2 * (params.nSynapses - 1));
  const tauR = receptor === 'NMDA' ? 15 : 3;
  const tauD = receptor === 'NMDA'
    ? 200 * (1 + params.caPermeability)
    : 35 * (1 + 0.1 * params.caPermeability);
  const rise = 1 - Math.exp(-t / tauR);
  const decay = Math.exp(-t / tauD);
  return baseAmp * rise * decay;
}

function renderGraph(now) {
  const ratio = window.devicePixelRatio || 1;
  const w = graphCanvas.width / ratio;
  const h = graphCanvas.height / ratio;
  graphCtx.clearRect(0, 0, w, h);

  // vertical grid
  graphCtx.strokeStyle = 'rgba(255,255,255,0.08)';
  graphCtx.lineWidth = 1;
  graphCtx.beginPath();
  for (let i = 0; i <= 5; i += 1) {
    const x = (w * i) / 5;
    graphCtx.moveTo(x, 0);
    graphCtx.lineTo(x, h);
  }
  graphCtx.stroke();

  const windowMs = 10000;
  const start = now - windowMs;
  const maxAmp = 6; // display scaling

  state.spikes.forEach((spike) => {
    const color = palette[spike.synapseId % palette.length];
    const t0 = spike.t;
    const end = t0 + 1000; // render first 1s of waveform
    if (end < start) return;
    graphCtx.strokeStyle = color;
    graphCtx.lineWidth = 2;
    graphCtx.beginPath();
    let started = false;
    const samples = 48;
    for (let i = 0; i <= samples; i += 1) {
      const t = t0 + (i / samples) * 1000;
      if (t < start || t > now) continue;
      const rel = t - start;
      const x = (rel / windowMs) * w;
      const amp = spikeValue(spike, t - t0);
      const y = h - Math.min(h * 0.9, (amp / maxAmp) * h * 0.8) - h * 0.05;
      if (!started) {
        graphCtx.moveTo(x, y);
        started = true;
      } else {
        graphCtx.lineTo(x, y);
      }
    }
    graphCtx.stroke();
  });
}

function updateCardFromSynapse(syn) {
  const { badge, paramLabels } = syn.view;
  if (!syn.assigned) {
    badge.className = 'badge unassigned';
    badge.textContent = 'open';
  } else {
    badge.className = `badge ${syn.receptor === 'NMDA' ? 'nmda' : 'ampa'}`;
    badge.textContent = syn.receptor;
  }
  paramLabels.caPermeability.textContent = syn.params.caPermeability.toFixed(2);
  paramLabels.pRelease.textContent = syn.params.pRelease.toFixed(2);
  paramLabels.nSynapses.textContent = syn.params.nSynapses.toString();
  paramLabels.quantalResponse.textContent = syn.params.quantalResponse.toFixed(2);
}

function renderLoop() {
  const now = performance.now();
  state.synapses.forEach((syn) => {
    const view = syn.view;
    const remaining = Math.max(0, view.flashUntil - now);
    const intensity = remaining > 0 ? view.flashPower * (remaining / 800) : 0;
    drawSynapse(view.canvas, syn, intensity);
    updateCardFromSynapse(syn);
  });
  renderGraph(now);
  requestAnimationFrame(renderLoop);
}

function applyStateSynapses(serverSynapses) {
  serverSynapses.forEach((s) => {
    const local = state.synapses[s.synapseId];
    if (!local) return;
    local.assigned = s.assigned;
    local.receptor = s.receptor;
    local.params = s.params || defaultParams();
  });
  updateCounts();
}

function wireEvents() {
  if (state.eventSource) state.eventSource.close();
  const es = new EventSource('/api/events');

  es.addEventListener('state', (evt) => {
    const data = JSON.parse(evt.data);
    applyStateSynapses(data.synapses || []);
  });

  es.addEventListener('join', (evt) => {
    const data = JSON.parse(evt.data);
    const syn = state.synapses[data.synapseId];
    if (syn) {
      syn.assigned = true;
      syn.receptor = data.receptor;
      syn.params = data.params || syn.params;
      syn.view.flashUntil = performance.now() + 600;
      syn.view.flashPower = 0.6;
    }
    updateCounts();
  });

  es.addEventListener('leave', (evt) => {
    const data = JSON.parse(evt.data);
    const syn = state.synapses[data.synapseId];
    if (syn) {
      syn.assigned = false;
      syn.receptor = null;
      syn.params = defaultParams();
    }
    updateCounts();
  });

  es.addEventListener('spike', (evt) => {
    const data = JSON.parse(evt.data);
    const syn = state.synapses[data.synapseId];
    if (syn) {
      syn.view.flashUntil = performance.now() + 800;
      syn.view.flashPower = data.power || 1;
    }
    recordSpike(data);
  });

  es.addEventListener('params', (evt) => {
    const data = JSON.parse(evt.data);
    const syn = state.synapses[data.synapseId];
    if (syn) {
      syn.params = data.params;
    }
  });

  es.addEventListener('reset', (evt) => {
    const data = JSON.parse(evt.data);
    state.sessionId = data.sessionId;
    state.joinUrl = data.joinUrl || state.joinUrl;
    state.qrDataUrl = data.qrDataUrl || '';
    state.synapseCount = data.synapseCount || state.synapseCount;
    ensureSynapses(state.synapseCount);
    applyStateSynapses(data.synapses || []);
    document.getElementById('session-id').textContent = state.sessionId;
    document.getElementById('join-link').textContent = state.joinUrl;
    renderQrCode(state.qrDataUrl, state.joinUrl);
  });

  es.onerror = () => {
    document.getElementById('connected-count').textContent = 'Connection lost…';
  };

  state.eventSource = es;
}

async function resetSession() {
  await fetch('/api/reset', { method: 'POST' });
}

async function init() {
  resizeGraph();
  window.addEventListener('resize', resizeGraph);
  const info = await fetch('/api/session').then((r) => r.json());
  state.sessionId = info.sessionId;
  state.joinUrl = info.joinUrl;
  state.qrDataUrl = info.qrDataUrl || '';
  state.synapseCount = info.synapseCount;
  ensureSynapses(info.synapseCount);
  applyStateSynapses(info.state.synapses || []);

  document.getElementById('join-link').textContent = state.joinUrl;
  document.getElementById('session-id').textContent = info.sessionId;
  renderQrCode(state.qrDataUrl, state.joinUrl);

  document.getElementById('reset-button').addEventListener('click', resetSession);

  wireEvents();
  renderLoop();
}

init().catch((err) => {
  console.error(err);
  document.getElementById('connected-count').textContent = 'Failed to load.';
});
