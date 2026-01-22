const fs = require('fs');
const path = require('path');

// Create rounds directory if it doesn't exist
const roundsDir = path.join(__dirname, 'rounds');
if (!fs.existsSync(roundsDir)) {
    fs.mkdirSync(roundsDir);
}

// Generate realistic game data based on analyzed patterns
function generateRoundData(roundNumber) {
    const totalPlayers = Math.floor(Math.random() * 300) + 150; // 150-450 players
    const crashMultiplier = generateRealisticCrashMultiplier();
    const gameDuration = generateGameDuration(crashMultiplier);
    
    const bets = [];
    const cashouts = [];
    
    // Generate bets with realistic patterns
    for (let i = 1; i <= totalPlayers; i++) {
        const bet = {
            id: i,
            i: Math.floor(Math.random() * 2), // 0 or 1 (bet type indicator)
            u: generateUsername(),
            bet: generateRealisticBetAmount()
        };
        bets.push(bet);
    }
    
    // Generate cashouts (60-80% of players cash out before crash)
    const cashoutRate = 0.6 + Math.random() * 0.2;
    const playersWhoCashout = Math.floor(totalPlayers * cashoutRate);
    
    // Sort bets by amount for more realistic cashout distribution
    const sortedBets = [...bets].sort((a, b) => b.bet - a.bet);
    
    for (let i = 0; i < playersWhoCashout; i++) {
        const bet = sortedBets[i];
        const cashoutMultiplier = generateCashoutMultiplier(crashMultiplier);
        
        const cashout = {
            id: bet.id,
            win: parseFloat((bet.bet * cashoutMultiplier).toFixed(2)),
            k: cashoutMultiplier
        };
        cashouts.push(cashout);
    }
    
    // Sort cashouts by multiplier (chronological order)
    cashouts.sort((a, b) => a.k - b.k);
    
    return {
        roundNumber,
        bets,
        cashouts,
        crashMultiplier,
        gameDuration,
        totalPlayers,
        metadata: {
            generated: new Date().toISOString(),
            cashoutRate: parseFloat(cashoutRate.toFixed(2)),
            averageBet: parseFloat((bets.reduce((sum, bet) => sum + bet.bet, 0) / bets.length).toFixed(2)),
            totalBetAmount: parseFloat(bets.reduce((sum, bet) => sum + bet.bet, 0).toFixed(2)),
            totalWinAmount: parseFloat(cashouts.reduce((sum, cashout) => sum + cashout.win, 0).toFixed(2))
        }
    };
}

function generateRealisticCrashMultiplier() {
    // Based on crash game statistics, most crashes happen between 1.01-3.00
    const rand = Math.random();
    
    if (rand < 0.4) {
        // 40% chance: 1.01 - 1.50
        return parseFloat((1.01 + Math.random() * 0.49).toFixed(2));
    } else if (rand < 0.7) {
        // 30% chance: 1.50 - 3.00
        return parseFloat((1.50 + Math.random() * 1.50).toFixed(2));
    } else if (rand < 0.9) {
        // 20% chance: 3.00 - 10.00
        return parseFloat((3.00 + Math.random() * 7.00).toFixed(2));
    } else {
        // 10% chance: 10.00 - 100.00 (rare high multipliers)
        return parseFloat((10.00 + Math.random() * 90.00).toFixed(2));
    }
}

function generateGameDuration(crashMultiplier) {
    // Game duration roughly correlates with crash multiplier
    // Base duration: 2-4 seconds, then additional time based on multiplier
    const baseDuration = 2000 + Math.random() * 2000;
    const multiplierBonus = Math.log(crashMultiplier) * 1000;
    return Math.floor(baseDuration + multiplierBonus);
}

function generateUsername() {
    // Generate realistic usernames (2-3 characters/numbers)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = Math.random() < 0.7 ? 2 : 3;
    let username = '';
    for (let i = 0; i < length; i++) {
        username += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return username;
}

function generateRealisticBetAmount() {
    // Realistic bet distribution
    const rand = Math.random();
    
    if (rand < 0.3) {
        // 30% small bets: 10-100
        return parseFloat((10 + Math.random() * 90).toFixed(2));
    } else if (rand < 0.6) {
        // 30% medium bets: 100-500
        return parseFloat((100 + Math.random() * 400).toFixed(2));
    } else if (rand < 0.85) {
        // 25% large bets: 500-2000
        return parseFloat((500 + Math.random() * 1500).toFixed(2));
    } else {
        // 15% very large bets: 2000-10000
        return parseFloat((2000 + Math.random() * 8000).toFixed(2));
    }
}

function generateCashoutMultiplier(crashMultiplier) {
    // Players cash out at various points before crash
    // Most cash out early for safety
    const rand = Math.random();
    const maxMultiplier = crashMultiplier * 0.95; // Don't cash out too close to crash
    
    if (rand < 0.4) {
        // 40% cash out very early (1.01 - 1.50)
        return parseFloat((1.01 + Math.random() * Math.min(0.49, maxMultiplier - 1.01)).toFixed(2));
    } else if (rand < 0.7) {
        // 30% cash out early-medium (1.50 - 2.50)
        const min = Math.max(1.50, 1.01);
        const max = Math.min(2.50, maxMultiplier);
        return parseFloat((min + Math.random() * (max - min)).toFixed(2));
    } else {
        // 30% cash out later (2.50 - crash point)
        const min = Math.max(2.50, 1.01);
        const max = maxMultiplier;
        return parseFloat((min + Math.random() * (max - min)).toFixed(2));
    }
}

// Generate all 100 rounds
console.log('Generating 100 game rounds...');

for (let i = 1; i <= 100; i++) {
    const roundData = generateRoundData(i);
    const filename = path.join(roundsDir, `round${i}.json`);
    
    fs.writeFileSync(filename, JSON.stringify(roundData, null, 2));
    
    if (i % 10 === 0) {
        console.log(`Generated ${i}/100 rounds...`);
    }
}

console.log('✅ Successfully generated 100 game rounds!');
console.log(`📁 Files saved in: ${roundsDir}`);

// Generate summary statistics
const summaryStats = {
    totalRounds: 100,
    averagePlayersPerRound: 0,
    averageCrashMultiplier: 0,
    averageGameDuration: 0,
    totalBetsGenerated: 0,
    totalCashoutsGenerated: 0
};

let totalPlayers = 0;
let totalCrashMultiplier = 0;
let totalGameDuration = 0;
let totalBets = 0;
let totalCashouts = 0;

for (let i = 1; i <= 100; i++) {
    const roundData = JSON.parse(fs.readFileSync(path.join(roundsDir, `round${i}.json`), 'utf8'));
    totalPlayers += roundData.totalPlayers;
    totalCrashMultiplier += roundData.crashMultiplier;
    totalGameDuration += roundData.gameDuration;
    totalBets += roundData.bets.length;
    totalCashouts += roundData.cashouts.length;
}

summaryStats.averagePlayersPerRound = Math.round(totalPlayers / 100);
summaryStats.averageCrashMultiplier = parseFloat((totalCrashMultiplier / 100).toFixed(2));
summaryStats.averageGameDuration = Math.round(totalGameDuration / 100);
summaryStats.totalBetsGenerated = totalBets;
summaryStats.totalCashoutsGenerated = totalCashouts;

fs.writeFileSync(path.join(roundsDir, 'summary.json'), JSON.stringify(summaryStats, null, 2));

console.log('\n📊 Generation Summary:');
console.log(`Average players per round: ${summaryStats.averagePlayersPerRound}`);
console.log(`Average crash multiplier: ${summaryStats.averageCrashMultiplier}x`);
console.log(`Average game duration: ${summaryStats.averageGameDuration}ms`);
console.log(`Total bets generated: ${summaryStats.totalBetsGenerated}`);
console.log(`Total cashouts generated: ${summaryStats.totalCashoutsGenerated}`);
console.log(`Average cashout rate: ${((summaryStats.totalCashoutsGenerated / summaryStats.totalBetsGenerated) * 100).toFixed(1)}%`);