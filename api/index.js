// Vercel serverless entrypoint mirroring the local server behavior.
// Supports SSE for the display and REST-ish POST endpoints for controllers.

const { randomUUID, randomBytes } = require('crypto');

const SYNAPSE_COUNT = Number(process.env.SYNAPSES || 10);

let sessionId = randomBytes(4).toString('hex');

// synapseId -> { clientId, receptor, params }
const assignments = new Map();
// clientId -> { synapseId, joinedAt, receptor }
const controllers = new Map();
const displays = new Set(); // Server-Sent Event response objects

const defaultParams = () => ({
  caPermeability: 0.5,
  pRelease: 0.5,
  nSynapses: 1,
  quantalResponse: 1,
});

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function notFound(res) {
  res.statusCode = 404;
  res.end('Not found');
}

function buildJoinUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string'
    ? forwardedProto.split(',')[0].trim()
    : (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}/join/${sessionId}`;
}

function currentState() {
  return {
    sessionId,
    synapseCount: SYNAPSE_COUNT,
    synapses: Array.from({ length: SYNAPSE_COUNT }, (_, id) => {
      const assigned = assignments.get(id);
      return {
        synapseId: id,
        assigned: Boolean(assigned),
        receptor: assigned?.receptor || null,
        params: assigned?.params || defaultParams(),
      };
    }),
  };
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  displays.forEach((res) => res.write(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString();
      if (raw.length > 1e6) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function allocateSynapse() {
  for (let i = 0; i < SYNAPSE_COUNT; i += 1) {
    if (!assignments.has(i)) return i;
  }
  return null;
}

async function handleJoin(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }
  if (body.sessionId !== sessionId) {
    sendJson(res, 410, { error: 'Session expired, refresh display to get a new code.' });
    return;
  }
  const synapseId = allocateSynapse();
  if (synapseId === null) {
    sendJson(res, 409, { error: 'All synapses are claimed right now.' });
    return;
  }
  const clientId = randomUUID();
  const receptor = Math.random() < 0.5 ? 'AMPA' : 'NMDA';
  const params = defaultParams();
  assignments.set(synapseId, { clientId, receptor, params });
  controllers.set(clientId, { synapseId, joinedAt: Date.now(), receptor });
  const payload = { synapseId, clientId, receptor, params, at: Date.now() };
  broadcast('join', payload);
  sendJson(res, 200, {
    clientId,
    synapseId,
    receptor,
    params,
    sessionId,
    synapseCount: SYNAPSE_COUNT,
  });
}

async function handleSpike(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }
  const { clientId, synapseId, sessionId: postedSession, power = 1 } = body;
  if (postedSession !== sessionId) {
    sendJson(res, 410, { error: 'Session expired, re-scan the QR code.' });
    return;
  }
  const controller = controllers.get(clientId);
  if (!controller || controller.synapseId !== Number(synapseId)) {
    sendJson(res, 403, { error: 'Unknown controller or synapse mismatch.' });
    return;
  }
  const spike = {
    synapseId: Number(synapseId),
    power: Math.max(0.2, Math.min(2, Number(power) || 1)),
    at: Date.now(),
  };
  broadcast('spike', spike);
  sendJson(res, 200, { ok: true });
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return Math.min(max, Math.max(min, num));
  }
  return fallback;
}

async function handleUpdate(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }
  const { clientId, synapseId, sessionId: postedSession, params = {} } = body;
  if (postedSession !== sessionId) {
    sendJson(res, 410, { error: 'Session expired, re-scan the QR code.' });
    return;
  }
  const controller = controllers.get(clientId);
  if (!controller || controller.synapseId !== Number(synapseId)) {
    sendJson(res, 403, { error: 'Unknown controller or synapse mismatch.' });
    return;
  }
  const record = assignments.get(Number(synapseId));
  if (!record) {
    sendJson(res, 404, { error: 'Synapse not assigned.' });
    return;
  }
  record.params = {
    ...record.params,
    caPermeability: clamp(params.caPermeability, 0, 2, record.params.caPermeability),
    pRelease: clamp(params.pRelease, 0, 1, record.params.pRelease),
    nSynapses: Math.round(clamp(params.nSynapses, 1, 10, record.params.nSynapses)),
    quantalResponse: clamp(params.quantalResponse, 0.1, 5, record.params.quantalResponse),
  };
  assignments.set(Number(synapseId), record);
  const payload = { synapseId: Number(synapseId), params: record.params };
  broadcast('params', payload);
  sendJson(res, 200, { ok: true, params: record.params });
}

async function handleLeave(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }
  const { clientId, sessionId: postedSession } = body;
  if (postedSession !== sessionId || !controllers.has(clientId)) {
    sendJson(res, 200, { ok: true });
    return;
  }
  const synapseId = controllers.get(clientId).synapseId;
  controllers.delete(clientId);
  assignments.delete(synapseId);
  broadcast('leave', { synapseId, at: Date.now() });
  sendJson(res, 200, { ok: true });
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: state\ndata: ${JSON.stringify(currentState())}\n\n`);
  const keepAlive = setInterval(() => res.write(':ping\n\n'), 20000);
  displays.add(res);
  req.on('close', () => {
    clearInterval(keepAlive);
    displays.delete(res);
  });
}

function resetSession() {
  sessionId = randomBytes(4).toString('hex');
  assignments.clear();
  controllers.clear();
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // Serve static files: Vercel will handle /public automatically; we only handle API routes here.
  if (!pathname.startsWith('/api/')) {
    notFound(res);
    return;
  }

  const route = pathname.replace('/api', '');

  if (req.method === 'GET' && route === '/session') {
    sendJson(res, 200, {
      sessionId,
      joinUrl: buildJoinUrl(req),
      synapseCount: SYNAPSE_COUNT,
      state: currentState(),
    });
    return;
  }
  if (req.method === 'GET' && route === '/events') {
    handleEvents(req, res);
    return;
  }
  if (req.method === 'POST' && route === '/join') {
    await handleJoin(req, res);
    return;
  }
  if (req.method === 'POST' && route === '/spike') {
    await handleSpike(req, res);
    return;
  }
  if (req.method === 'POST' && route === '/update') {
    await handleUpdate(req, res);
    return;
  }
  if (req.method === 'POST' && route === '/leave') {
    await handleLeave(req, res);
    return;
  }
  if (req.method === 'POST' && route === '/reset') {
    resetSession();
    sendJson(res, 200, { sessionId, synapseCount: SYNAPSE_COUNT });
    broadcast('reset', currentState());
    return;
  }

  notFound(res);
};

// Vercel function config
module.exports.config = {
  runtime: 'nodejs20.x',
  maxDuration: 60, // SSE connections will recycle at this limit
};
