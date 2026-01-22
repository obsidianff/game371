const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3002;
const FILE_PATH = path.resolve(__dirname, 'current.json');

let currentData = {};

function safeReadJSON() {
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function pickInitialFields(data) {
  return {
    crashMultiplier: data.crashMultiplier ?? null,
    gameStatus: data.gameStatus ?? null,
    predictedCrashTime: data.predictedCrashTime ?? null,
  };
}

function diff(prev, next) {
  const changed = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    const pv = prev[k];
    const nv = next[k];
    // Use JSON string compare to catch deep changes safely
    if (JSON.stringify(pv) !== JSON.stringify(nv)) {
      changed[k] = nv === undefined ? null : nv;
    }
  }
  return changed;
}

// Load initial state
currentData = safeReadJSON();

const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
  // Send initial required fields on connect
  const initialPayload = pickInitialFields(currentData);
  try {
    ws.send(JSON.stringify(initialPayload));
  } catch (e) {}
});

function broadcast(obj) {
  const payload = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (e) {}
    }
  }
}

// Watch the JSON file for changes and broadcast diffs
try {
  fs.watchFile(FILE_PATH, { interval: 500 }, () => {
    const nextData = safeReadJSON();
    const changes = diff(currentData, nextData);
    if (Object.keys(changes).length > 0) {
      broadcast(changes);
      currentData = nextData;
    }
  });
} catch (e) {
  // If watch fails, fall back to polling
  setInterval(() => {
    const nextData = safeReadJSON();
    const changes = diff(currentData, nextData);
    if (Object.keys(changes).length > 0) {
      broadcast(changes);
      currentData = nextData;
    }
  }, 1000);
}

console.log(`WebSocket server listening on ws://localhost:${PORT}`);