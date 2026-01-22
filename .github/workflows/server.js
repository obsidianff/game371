const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files to load client-test.html quickly
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.redirect('/client-test.html'));

// Game state
let currentRound = 1;
let gameRounds = [];
let clients = new Map();
let globalLoopStarted = false; // declare early to avoid temporal dead zone

// Load game rounds
function loadGameRounds() {
    gameRounds = [];
    for (let i = 1; i <= 100; i++) {
        try {
            const roundData = JSON.parse(fs.readFileSync(path.join(__dirname, 'rounds', `round${i}.json`), 'utf8'));
            gameRounds.push(roundData);
        } catch (error) {
            console.log(`Round ${i} file not found, will be created automatically`);
        }
    }
    console.log(`Loaded ${gameRounds.length} game rounds`);
}

// Client connection management
class ClientConnection {
    constructor(ws, clientId) {
        this.ws = ws;
        this.clientId = clientId;
        this.authenticated = false;
        this.lastHeartbeat = Date.now();
        this.account = null;
        this.activity = null;
    }

    send(data) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    updateHeartbeat() {
        this.lastHeartbeat = Date.now();
    }

    isAlive() {
        return Date.now() - this.lastHeartbeat < 15000; // 15 seconds timeout
    }
}

// Authentication patterns
const VALID_PATTERNS = [
    { activity: 30, accountRange: [100000000, 999999999] }
];

function validateAuthPattern(activity, account) {
    return VALID_PATTERNS.some(pattern => 
        pattern.activity === activity && 
        account >= pattern.accountRange[0] && 
        account <= pattern.accountRange[1]
    );
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    const clientId = uuidv4();
    const client = new ClientConnection(ws, clientId);
    clients.set(clientId, client);
    
    console.log(`Client ${clientId} connected`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            handleClientMessage(client, data);
        } catch (error) {
            console.error('Invalid JSON received:', error);
            ws.close(1003, 'Invalid JSON');
        }
    });

    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`Client ${clientId} disconnected`);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
        clients.delete(clientId);
    });
});

function handleClientMessage(client, data) {
    client.updateHeartbeat();

    // Handle handshake
    if (data.protocol === 'json' && data.version === 1) {
        console.log(`Handshake received from ${client.clientId}`);
        client.send({}); // Empty response for handshake
        return;
    }

    // Handle authentication
    if (data.type === 1 && data.target === 'Account' && data.arguments) {
        const args = data.arguments[0];
        if (args && args.activity !== undefined && args.account !== undefined) {
            if (validateAuthPattern(args.activity, args.account)) {
                client.authenticated = true;
                client.account = args.account;
                client.activity = args.activity;
                
                // Send registration response
                const registrationResponse = {
                    type: 1,
                    target: "OnRegistration",
                    arguments: [{
                        ok: true,
                        u: args.account,
                        l: getCurrentRoundId(),
                        ln: getNextRoundId(),
                        s: 2,
                        a: 5315,
                        w: 2000,
                        d: 0,
                        n: 0,
                        bid: 0,
                        won: 0,
                        fs: generateRecentGames(),
                        v: { bu: true, bx: 2 },
                        q: [],
                        bets: [],
                        nbs: [],
                        h: []
                    }]
                };
                
                client.send(registrationResponse);
                
                // Send acknowledgment
                client.send({
                    type: 3,
                    invocationId: data.invocationId || "0",
                    result: null
                });
                
                console.log(`Client ${client.clientId} authenticated with account ${args.account}`);
                
                // Clients will receive the global broadcast loop; no per-client game loop needed
                // (Joined clients start receiving the current round's messages immediately)
                
            } else {
                client.send({
                    type: 1,
                    target: "OnError",
                    arguments: [{ message: "Access denied - Invalid pattern" }]
                });
                client.ws.close(1008, 'Access denied');
            }
        }
        return;
    }

    // Handle heartbeat/online messages
    if (data.type === 6 || (data.message && data.message.toLowerCase().includes('online'))) {
        // Client is alive, heartbeat updated automatically above
        return;
    }

    // Handle other messages for authenticated clients
    if (!client.authenticated) {
        client.ws.close(1008, 'Not authenticated');
        return;
    }
}

function getCurrentRoundId() {
    return 50946700 + currentRound;
}

function getNextRoundId() {
    return 50946700 + currentRound + 1;
}

function generateRecentGames() {
    const games = [];
    for (let i = 0; i < 10; i++) {
        games.push({
            l: getCurrentRoundId() - i - 1,
            f: parseFloat((Math.random() * 8 + 1).toFixed(2))
        });
    }
    return games;
}

// Broadcast helper: send data to all authenticated, connected clients at the same time
function broadcast(data){
  clients.forEach((client) => {
    if (client.authenticated && client.ws.readyState === WebSocket.OPEN){
      client.send(data);
    }
  });
}

function startGameForClient(client) {
    if (!client.authenticated || client.ws.readyState !== WebSocket.OPEN) return;
    
    // Send current game state
    sendGameRound(client);
}

function sendGameRound(client) {
    const roundData = getCurrentRoundData();
    if (!roundData) return;

    const roundId = getCurrentRoundId();
    const nextRoundId = getNextRoundId();
    const timestamp = Date.now();

    // Phase 1: OnStage
    client.send({
        type: 1,
        target: "OnStage",
        arguments: [{
            l: roundId,
            ln: nextRoundId,
            ts: timestamp
        }]
    });

    // Phase 2: OnBetting (1 second later)
    setTimeout(() => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        client.send({
            type: 1,
            target: "OnBetting",
            arguments: [{
                l: roundId,
                a: 5998,
                w: 2000,
                ts: timestamp + 1000
            }]
        });
    }, 1000);

    // Phase 3: Send OnBets during betting phase (7 seconds)
    sendBettingPhase(client, roundData, roundId);

    // Phase 4: OnStart (after 7 second betting phase)
    setTimeout(() => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        client.send({
            type: 1,
            target: "OnStart",
            arguments: [{
                l: roundId,
                ts: timestamp + 8000 // 1 second for OnBetting + 7 seconds for betting phase
            }]
        });

        // Phase 5: Send cashouts during flight
        sendCashoutPhase(client, roundData, roundId, timestamp + 8000);

    }, 8000); // 1 second for OnBetting + 7 seconds for betting phase
}

function sendBettingPhase(client, roundData, roundId) {
    const bets = roundData.bets || [];
    let currentBets = [];
    let totalBid = 0;
    let betIndex = 0;

    // Send bets in intervals during betting phase (7 seconds)
    const bettingInterval = setInterval(() => {
        if (client.ws.readyState !== WebSocket.OPEN) {
            clearInterval(bettingInterval);
            return;
        }

        // Add 5-15 new bets per interval
        const newBetsCount = Math.floor(Math.random() * 10) + 5;
        for (let i = 0; i < newBetsCount && betIndex < bets.length; i++, betIndex++) {
            const bet = bets[betIndex];
            currentBets.push(bet);
            totalBid += bet.bet;
        }

        if (currentBets.length > 0) {
            client.send({
                type: 1,
                target: "OnBets",
                arguments: [{
                    l: roundId,
                    bid: parseFloat(totalBid.toFixed(2)),
                    n: currentBets.length,
                    q: currentBets.slice(-Math.min(25, currentBets.length)) // Show last 25 bets
                }]
            });
        }

        // Send heartbeat occasionally
        if (Math.random() < 0.3) {
            client.send({ type: 6 });
        }

    }, 200); // Every 200ms during betting

    // Stop betting phase after 7 seconds
    setTimeout(() => {
        clearInterval(bettingInterval);
    }, 7000);
}

function sendCashoutPhase(client, roundData, roundId, startTime) {
    const cashouts = roundData.cashouts || [];
    const crashMultiplier = roundData.crashMultiplier || 2.0;
    
    // Calculate game duration based on crash multiplier formula: (crash_multiplier - 1) / 0.7
    const gameDuration = Math.round(((crashMultiplier - 1) / 0.7) * 1000); // Convert to milliseconds
    
    let totalWon = 0;
    let playersLeft = roundData.totalPlayers || 300;
    let cashoutIndex = 0;

    const cashoutInterval = setInterval(() => {
        if (client.ws.readyState !== WebSocket.OPEN) {
            clearInterval(cashoutInterval);
            return;
        }

        // Send some cashouts
        const cashoutsToSend = [];
        const cashoutsCount = Math.floor(Math.random() * 5) + 1;
        
        for (let i = 0; i < cashoutsCount && cashoutIndex < cashouts.length; i++, cashoutIndex++) {
            const cashout = cashouts[cashoutIndex];
            cashoutsToSend.push(cashout);
            totalWon += cashout.win;
            playersLeft--;
        }

        if (cashoutsToSend.length > 0) {
            client.send({
                type: 1,
                target: "OnCashouts",
                arguments: [{
                    l: roundId,
                    won: parseFloat(totalWon.toFixed(2)),
                    d: Math.max(0, playersLeft),
                    n: roundData.totalPlayers || 300,
                    q: cashoutsToSend
                }]
            });
        }

        // Send heartbeat occasionally
        if (Math.random() < 0.2) {
            client.send({ type: 6 });
        }

    }, 500); // Every 500ms during flight

    // Send crash after calculated game duration
    setTimeout(() => {
        clearInterval(cashoutInterval);
        
        if (client.ws.readyState !== WebSocket.OPEN) return;
        
        client.send({
            type: 1,
            target: "OnCrash",
            arguments: [{
                l: roundId,
                f: crashMultiplier,
                ts: startTime + gameDuration
            }]
        });

        // Move to next round after 3 seconds
        setTimeout(() => {
            currentRound = (currentRound % 100) + 1;
            if (client.ws.readyState === WebSocket.OPEN) {
                sendGameRound(client);
            }
        }, 3000);

    }, gameDuration);
}

function getCurrentRoundData() {
    if (gameRounds.length === 0) {
        // Generate default round data if no rounds loaded
        return generateDefaultRoundData();
    }
    
    const roundIndex = (currentRound - 1) % gameRounds.length;
    return gameRounds[roundIndex];
}

function generateDefaultRoundData() {
    const bets = [];
    const cashouts = [];
    const totalPlayers = Math.floor(Math.random() * 200) + 100;
    
    // Generate bets
    for (let i = 1; i <= totalPlayers; i++) {
        bets.push({
            id: i,
            i: Math.floor(Math.random() * 2),
            u: Math.floor(Math.random() * 99).toString().padStart(2, '0'),
            bet: parseFloat((Math.random() * 1000 + 50).toFixed(2))
        });
    }

    // Generate cashouts
    const crashMultiplier = parseFloat((Math.random() * 8 + 1.01).toFixed(2));
    for (let i = 1; i <= Math.floor(totalPlayers * 0.6); i++) {
        const multiplier = parseFloat((Math.random() * (crashMultiplier - 1.01) + 1.01).toFixed(2));
        const bet = bets[i - 1];
        cashouts.push({
            id: bet.id,
            win: parseFloat((bet.bet * multiplier).toFixed(2)),
            k: multiplier
        });
    }

    return {
        bets,
        cashouts,
        crashMultiplier,
        gameDuration: Math.floor(Math.random() * 8000) + 3000,
        totalPlayers
    };
}

// Client timeout checker
setInterval(() => {
    clients.forEach((client, clientId) => {
        if (!client.isAlive()) {
            console.log(`Client ${clientId} timed out`);
            client.ws.close(1000, 'Timeout');
            clients.delete(clientId);
        }
    });
}, 5000); // Check every 5 seconds

// Functions to handle current round prediction data
function saveCurrentRoundData(roundData) {
    try {
        const currentData = {
            currentRound: currentRound,
            roundId: getCurrentRoundId(),
            nextRoundId: getNextRoundId(),
            crashMultiplier: roundData.crashMultiplier,
            gameStartTime: null,
            gameStatus: "stage",
            timestamp: Date.now(),
            predictedCrashTime: null
        };
        fs.writeFileSync(path.join(__dirname, 'current.json'), JSON.stringify(currentData, null, 2));
        console.log(`Saved current round data: Round ${currentRound}, Crash at ${roundData.crashMultiplier}x`);
    } catch (error) {
        console.error('Error saving current round data:', error);
    }
}

function loadCurrentRoundData() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'current.json'), 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.log('No current round data found, will create new');
        return null;
    }
}

function updateCurrentRoundStatus(status, additionalData = {}) {
    try {
        const currentData = loadCurrentRoundData();
        if (currentData) {
            currentData.gameStatus = status;
            currentData.timestamp = Date.now();
            Object.assign(currentData, additionalData);
            fs.writeFileSync(path.join(__dirname, 'current.json'), JSON.stringify(currentData, null, 2));
        }
    } catch (error) {
        console.error('Error updating current round status:', error);
    }
}

// Load game rounds on startup
loadGameRounds();

// Start global broadcast loop so all clients get the same messages
startGlobalGameLoop();

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WebSocket server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    wss.clients.forEach((ws) => {
        ws.close(1001, 'Server shutting down');
    });
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Global game loop: broadcast the same messages to all clients simultaneously

function startGlobalGameLoop(){
  if (globalLoopStarted) return;
  globalLoopStarted = true;
  runRoundBroadcast();
}

function runRoundBroadcast(){
  const roundData = getCurrentRoundData();
  if (!roundData) return;

  const roundId = getCurrentRoundId();
  const nextRoundId = getNextRoundId();
  const timestamp = Date.now();

  // Save crash multiplier to current.json at the start of each round
  saveCurrentRoundData(roundData);

  // Phase 1: OnStage to everyone
  broadcast({
    type: 1,
    target: "OnStage",
    arguments: [{
      l: roundId,
      ln: nextRoundId,
      ts: timestamp
    }]
  });

  // Phase 2: OnBetting (1 second later)
  setTimeout(() => {
    updateCurrentRoundStatus("betting");
    broadcast({
      type: 1,
      target: "OnBetting",
      arguments: [{
        l: roundId,
        a: 5998,
        w: 2000,
        ts: timestamp + 1000
      }]
    });
  }, 1000);

  // Phase 3: Send OnBets during betting phase (7 seconds)
  sendBettingPhaseBroadcast(roundData, roundId);

  // Phase 4: OnStart (after betting)
  setTimeout(() => {
    const gameStartTime = timestamp + 8000;
    const gameDuration = Math.round(((roundData.crashMultiplier - 1) / 0.7) * 1000);
    const predictedCrashTime = gameStartTime + gameDuration;
    
    updateCurrentRoundStatus("flying", { 
      gameStartTime: gameStartTime,
      predictedCrashTime: predictedCrashTime
    });
    
    broadcast({
      type: 1,
      target: "OnStart",
      arguments: [{
        l: roundId,
        ts: gameStartTime // 1s OnBetting + 7s betting
      }]
    });

    // Phase 5: Cashouts during flight
    sendCashoutPhaseBroadcast(roundData, roundId, gameStartTime);
  }, 8000);
}

function sendBettingPhaseBroadcast(roundData, roundId){
  const bets = roundData.bets || [];
  let currentBets = [];
  let totalBid = 0;
  let betIndex = 0;

  const bettingInterval = setInterval(() => {
    // Add 5-15 new bets per tick
    const newBetsCount = Math.floor(Math.random() * 10) + 5;
    for (let i = 0; i < newBetsCount && betIndex < bets.length; i++, betIndex++) {
      const bet = bets[betIndex];
      currentBets.push(bet);
      totalBid += bet.bet;
    }

    if (currentBets.length > 0) {
      broadcast({
        type: 1,
        target: "OnBets",
        arguments: [{
          l: roundId,
          bid: parseFloat(totalBid.toFixed(2)),
          n: currentBets.length,
          q: currentBets.slice(-Math.min(25, currentBets.length))
        }]
      });
    }

    // Optional heartbeat broadcast
    if (Math.random() < 0.3) {
      broadcast({ type: 6 });
    }
  }, 200);

  setTimeout(() => {
    clearInterval(bettingInterval);
  }, 7000);
}

function sendCashoutPhaseBroadcast(roundData, roundId, startTime){
  const cashouts = roundData.cashouts || [];
  
  // Get crash multiplier from current.json instead of roundData
  const currentData = loadCurrentRoundData();
  const crashMultiplier = currentData ? currentData.crashMultiplier : (roundData.crashMultiplier || 2.0);
  const gameDuration = Math.round(((crashMultiplier - 1) / 0.7) * 1000);

  let totalWon = 0;
  let playersLeft = roundData.totalPlayers || 300;
  let cashoutIndex = 0;

  const cashoutInterval = setInterval(() => {
    const cashoutsToSend = [];
    const cashoutsCount = Math.floor(Math.random() * 5) + 1;

    for (let i = 0; i < cashoutsCount && cashoutIndex < cashouts.length; i++, cashoutIndex++) {
      const cashout = cashouts[cashoutIndex];
      cashoutsToSend.push(cashout);
      totalWon += cashout.win;
      playersLeft--;
    }

    if (cashoutsToSend.length > 0) {
      // Broadcast both plural and singular to be compatible with different clients
      broadcast({
        type: 1,
        target: "OnCashouts",
        arguments: [{
          l: roundId,
          won: parseFloat(totalWon.toFixed(2)),
          d: Math.max(0, playersLeft),
          n: roundData.totalPlayers || 300,
          q: cashoutsToSend
        }]
      });
      broadcast({
        type: 1,
        target: "OnCashout",
        arguments: [{
          l: roundId,
          won: parseFloat(totalWon.toFixed(2)),
          d: Math.max(0, playersLeft),
          n: roundData.totalPlayers || 300,
          q: cashoutsToSend
        }]
      });
    }

    // Optional heartbeat broadcast
    if (Math.random() < 0.2) {
      broadcast({ type: 6 });
    }
  }, 500);

  setTimeout(() => {
    clearInterval(cashoutInterval);

    // Update status to crashed
    updateCurrentRoundStatus("crashed");

    // Crash broadcast - use the pre-stored crash multiplier from current.json
    const finalCurrentData = loadCurrentRoundData();
    const finalCrashMultiplier = finalCurrentData ? finalCurrentData.crashMultiplier : crashMultiplier;
    
    broadcast({
      type: 1,
      target: "OnCrash",
      arguments: [{
        l: roundId,
        f: finalCrashMultiplier,
        ts: startTime + gameDuration
      }]
    });

    // Move to next round and immediately run again after short pause
    setTimeout(() => {
      currentRound = (currentRound % 100) + 1;
      runRoundBroadcast();
    }, 3000); // 3 second pause before next round
  }, gameDuration);
}