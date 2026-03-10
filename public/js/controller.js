const statusEl = document.getElementById('controller-status');
const titleEl = document.getElementById('controller-title');
const tagEl = document.getElementById('synapse-tag');
const sessionLabel = document.getElementById('session-label');
const receptorLabel = document.getElementById('receptor-label');
const latencyLabel = document.getElementById('latency-label');
const fireBtn = document.getElementById('fire-btn');
const autoBtn = document.getElementById('auto-btn');
const caSlider = document.getElementById('ca-slider');
const prelSlider = document.getElementById('prel-slider');
const nsynSlider = document.getElementById('nsyn-slider');
const quantalSlider = document.getElementById('quantal-slider');
const caLabel = document.getElementById('ca-label');
const prelLabel = document.getElementById('prel-label');
const nsynLabel = document.getElementById('nsyn-label');
const quantalLabel = document.getElementById('quantal-label');

let sessionId = null;
let clientId = null;
let synapseId = null;
let lastPing = null;
let receptor = null;
let sendTimer = null;
let autoOn = false;
let autoTimer = null;

const params = {
  caPermeability: 0.5,
  pRelease: 0.5,
  nSynapses: 1,
  quantalResponse: 1,
};

function renderParamLabels() {
  caLabel.textContent = params.caPermeability.toFixed(2);
  prelLabel.textContent = params.pRelease.toFixed(2);
  nsynLabel.textContent = params.nSynapses.toString();
  quantalLabel.textContent = params.quantalResponse.toFixed(2);
}

function scheduleUpdate() {
  if (!clientId) return;
  if (sendTimer) window.clearTimeout(sendTimer);
  sendTimer = window.setTimeout(async () => {
    sendTimer = null;
    try {
      await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          synapseId,
          sessionId,
          params,
        }),
      });
    } catch (err) {
      console.error('update failed', err);
    }
  }, 120);
}

function parseSessionId() {
  const parts = window.location.pathname.split('/');
  const maybe = parts[2];
  return maybe || null;
}

async function joinSession() {
  sessionId = parseSessionId();
  if (!sessionId) {
    statusEl.textContent = 'Missing session id in URL.';
    return;
  }
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: 'Unable to join.' }));
    statusEl.textContent = error || 'Unable to join.';
    return;
  }
  const data = await res.json();
  clientId = data.clientId;
  synapseId = data.synapseId;
  sessionId = data.sessionId;
  receptor = data.receptor;
  Object.assign(params, data.params || {});
  titleEl.textContent = `Synapse ${synapseId + 1}`;
  tagEl.textContent = `ID ${synapseId + 1}`;
  receptorLabel.textContent = `Receptor: ${receptor}`;
  sessionLabel.textContent = `Session ${sessionId}`;
  renderParamLabels();
  caSlider.value = params.caPermeability;
  prelSlider.value = params.pRelease;
  nsynSlider.value = params.nSynapses;
  quantalSlider.value = params.quantalResponse;
  statusEl.textContent = 'Connected. Tap to fire spikes.';
  fireBtn.disabled = false;
  autoBtn.disabled = false;
}

async function fireSpike() {
  if (!clientId) return;
  const started = performance.now();
  const res = await fetch('/api/spike', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, synapseId, sessionId }),
  });
  if (res.ok) {
    lastPing = performance.now() - started;
    latencyLabel.textContent = `${Math.round(lastPing)} ms`;
  } else if (res.status === 410) {
    statusEl.textContent = 'Session expired. Please re-scan the QR code.';
    fireBtn.disabled = true;
    stopAuto();
  }
}

async function leave() {
  if (!clientId) return;
  stopAuto();
  try {
    await fetch('/api/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ clientId, sessionId }),
    });
  } catch (_) {
    // ignore
  }
}

fireBtn.addEventListener('click', fireSpike);
window.addEventListener('beforeunload', leave);

function stopAuto() {
  autoOn = false;
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  autoBtn.textContent = 'Auto spike: off';
}

async function autoLoop() {
  if (!autoOn) return;
  try {
    await fireSpike();
  } catch (err) {
    console.error('auto spike failed', err);
    stopAuto();
    return;
  }
  autoTimer = setTimeout(autoLoop, 2000);
}

autoBtn.addEventListener('click', () => {
  if (!clientId) return;
  if (autoOn) {
    stopAuto();
  } else {
    autoOn = true;
    autoBtn.textContent = 'Auto spike: on (2s)';
    autoLoop();
  }
});

caSlider.addEventListener('input', () => {
  params.caPermeability = Number(caSlider.value);
  renderParamLabels();
  scheduleUpdate();
});
prelSlider.addEventListener('input', () => {
  params.pRelease = Number(prelSlider.value);
  renderParamLabels();
  scheduleUpdate();
});
nsynSlider.addEventListener('input', () => {
  params.nSynapses = Number(nsynSlider.value);
  renderParamLabels();
  scheduleUpdate();
});
quantalSlider.addEventListener('input', () => {
  params.quantalResponse = Number(quantalSlider.value);
  renderParamLabels();
  scheduleUpdate();
});

joinSession().catch((err) => {
  console.error(err);
  statusEl.textContent = 'Unexpected error while joining.';
});
