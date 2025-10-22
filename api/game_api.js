// api/game_api.js - Handles Betting, Balance Sync, and Game State

const connectToDatabase = require('./utils/db');
const User = require('./models/User');
const Transaction = require('./models/Transaction');
const config = require('./config');

// NOTE: In a real environment, the Game State (period, timer, results) would be managed 
// by a separate, persistent service (like a background Node.js server or a cron job)
// that the API fetches from. For this Vercel serverless model, we will mock the state 
// and focus on the secure transactional logic.

// --- MOCK GAME STATE (Replace with persistent storage in production) ---
let currentPeriod = {
    id: 20251022000001,
    secondsLeft: 60,
    status: 'open', // 'open', 'closing', 'result'
    lastResult: null
};

// Simple function to advance the game state
function updateGameState() {
    currentPeriod.secondsLeft--;
    if (currentPeriod.secondsLeft < 0) {
        // --- Game Result & Payout Mock ---
        const resultNumber = Math.floor(Math.random() * 10); // 0-9
        
        // This is where the Payout logic should run in a real system:
        // 1. Fetch all 'Bet' transactions for the old period ID.
        // 2. Calculate wins/losses based on the resultNumber.
        // 3. Update user balances and create 'Win' transactions.
        
        currentPeriod.lastResult = resultNumber;
        currentPeriod.id += 1;
        currentPeriod.secondsLeft = 60; // Reset timer
        currentPeriod.status = 'open';
    }
}
// In a real system, setInterval(updateGameState, 1000) runs on a separate server.
// Here, we simulate by checking the clock in the sync API.


// --- API Handlers ---

/**
 * Endpoint to sync the game state, user balance, and history.
 */
async function handleSync(req, res) {
    // 1. Connect to DB
    await connectToDatabase();
    
    // 2. Validate Telegram User (Using TG ID from query for simplicity, but secure TWA data must be used)
    const tgId = req.query.tgId;
    if (!tgId) {
        return res.status(400).json({ error: "Missing Telegram User ID" });
    }
    
    const user = await User.findOne({ telegramId: tgId });
    if (!user) {
        return res.status(404).json({ error: "User not found. Please restart bot." });
    }
    
    // 3. Fetch User's Last 10 Bets
    const myBets = await Transaction.find({ telegramId: tgId, type: { $in: ['Bet', 'Win'] } })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('transactionId selection amount status createdAt');
        
    // 4. Fetch Global Last 10 Results
    // In a real system, this fetches from a dedicated Results table.
    const globalHistory = [
        // Mock data for the last few results
        { period: '20251022000000', result: 5, color: 'Violet' },
        { period: '20251022000099', result: 2, color: 'Red' },
        { period: '20251022000098', result: 7, color: 'Green' },
        { period: '20251022000097', result: 0, color: 'Violet' },
    ];
    
    // 5. Return all data
    res.status(200).json({
        user: {
            balance: user.balance,
            currentRollover: user.currentBetRollover,
            requiredRollover: user.lastDepositAmount * config.WITHDRAWAL_ROLLOVER_MULTIPLIER
        },
        gameState: currentPeriod, // Sends the current mock state
        history: {
            global: globalHistory,
            myBets: myBets
        }
    });
}

/**
 * Endpoint to place a bet.
 */
async function handleBet(req, res) {
    // 1. Validate Input (Requires proper TWA initData check for security in production!)
    const { tgId, selection, amount, auth } = req.body; 
    
    if (!tgId || !selection || !amount) {
        return res.status(400).json({ message: "Missing required bet data." });
    }
    
    // 2. Connect to DB and Lock User (Crucial for transactional integrity)
    await connectToDatabase();
    // Use findOneAndUpdate with runValidators to lock the document and ensure atomicity
    const user = await User.findOne({ telegramId: tgId });
    
    if (!user) {
        return res.status(404).json({ message: "User not found." });
    }
    
    if (user.balance < amount) {
        return res.status(402).json({ message: "Insufficient balance to place this bet." });
    }

    // 3. Deduct Balance and Update Rollover (The core transaction)
    const newBalance = user.balance - amount;
    const newRollover = user.currentBetRollover + amount;

    // Use updateOne as it is sufficient for atomic balance changes
    const updateResult = await User.updateOne(
        { telegramId: tgId, balance: user.balance }, // Optimistic locking
        { 
            $set: { 
                balance: newBalance,
                currentBetRollover: newRollover,
                updatedAt: new Date()
            }
        }
    );
    
    if (updateResult.modifiedCount === 0) {
        // This indicates a concurrency issue (another bet/deposit happened simultaneously)
        return res.status(409).json({ message: "Transaction failed due to concurrency. Please try again." });
    }

    // 4. Log Transaction
    const transactionId = `BET-${currentPeriod.id}-${Math.random().toString(36).substring(7).toUpperCase()}`;
    await Transaction.create({
        transactionId,
        telegramId: tgId,
        type: 'Bet',
        amount: amount,
        status: 'Success',
        method: 'Game',
        selection: selection
    });

    // 5. Success Response
    res.status(200).json({ 
        message: "Bet placed successfully!", 
        newBalance: newBalance,
        newRollover: newRollover,
        periodId: currentPeriod.id
    });
}


// --- VERCEL Serverless Entry Point ---

module.exports = async (req, res) => {
    // Vercel serverless function boilerplate
    if (req.method === 'GET' && req.query.action === 'sync') {
        return await handleSync(req, res);
    } 
    
    if (req.method === 'POST' && req.body.action === 'bet') {
        return await handleBet(req, res);
    }
    
    res.status(405).json({ message: "Method Not Allowed or Missing Action Parameter" });
};
