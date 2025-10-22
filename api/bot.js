// api/bot.js - The Main Telegram Bot Handler

const TelegramBot = require('node-telegram-bot-api');
const connectToDatabase = require('./utils/db');
const User = require require('./models/User');
const Transaction = require('./models/Transaction');
const config = require('./config');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: false });

// --- Keyboard Definitions ---
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '💰 Deposit' }, { text: '💸 Withdrawal' }],
            [{ text: '👤 Profile' }, { text: '🎁 Share & Earn' }],
            [{ text: '🎮 Play', web_app: { url: config.GAME_APP_URL } }] 
        ],
        resize_keyboard: true
    }
};

// --- Core Utility Functions ---

async function initializeUser(msg) {
    await connectToDatabase();
    const telegramId = msg.from.id;
    let user = await User.findOne({ telegramId });
    
    // If no user, create one.
    if (!user) {
        user = new User({ telegramId, username: msg.from.username, firstName: msg.from.first_name });
        await user.save();
    }
    
    return user;
}

// --- Specific Flow Handlers ---

function getDepositOptions() {
    return {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: '🏦 Bank Transfer', callback_data: 'deposit_bank' }],
                [{ text: ' UPI/QR Code', callback_data: 'deposit_upi' }]
            ]
        })
    };
}

function getWithdrawalOptions() {
    return {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: '🏦 Bank Account', callback_data: 'withdrawal_bank' }],
                [{ text: ' UPI ID', callback_data: 'withdrawal_upi' }]
            ]
        })
    };
}


// --- STATE MACHINE (Message Handler) ---

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (msg.is_automatic_forward) return;
    const user = await initializeUser(msg); 
    
    const currentState = user.state;
    
    // 1. Handle commands or state-specific input
    if (text.startsWith('/') || currentState !== 'idle') {
        // Clear state if the user types /start at any point
        if (text.startsWith('/start')) {
            await User.updateOne({ telegramId: chatId }, { $set: { state: 'idle', tempData: {} } });
            bot.sendMessage(chatId, `Welcome back, ${user.firstName}! What would you like to do?`, mainKeyboard);
            return;
        }

        switch (currentState) {
            case 'waiting_for_deposit_amount':
                await handleDepositAmountInput(chatId, user, text);
                return;
            case 'waiting_for_deposit_utr':
                await handleDepositUTRInput(chatId, user, text);
                return;
            case 'waiting_for_withdrawal_amount':
                await handleWithdrawalAmountInput(chatId, user, text);
                return;
            case 'waiting_for_withdrawal_detail_1':
            case 'waiting_for_withdrawal_detail_2':
                await handleWithdrawalDetailsInput(chatId, user, text);
                return;
            // Add handler for admin /confirm_deposit
            case '/confirm_deposit': // Not a real state, but catches the admin command
                if (chatId.toString() === config.ADMIN_GROUP_CHAT_ID.toString() && text.startsWith('/confirm_deposit')) {
                    await handleAdminConfirmDeposit(chatId, text, msg.from.username);
                    return;
                }
                break;
        }
        
        // If state is active but input is invalid for that state
        if (currentState !== 'idle') {
             bot.sendMessage(chatId, `Please complete the current process. Current step: ${currentState.replace(/_/g, ' ')}. Or type /start to cancel.`);
             return;
        }
    }
    
    // 2. Handle Main Menu Clicks
    switch (text) {
        case '💰 Deposit':
            bot.sendMessage(chatId, "Please choose your preferred deposit method:", getDepositOptions());
            break;
        case '💸 Withdrawal':
            bot.sendMessage(chatId, "Please choose where to receive your funds:", getWithdrawalOptions());
            break;
        case '👤 Profile':
            bot.sendMessage(chatId, 
                `👤 **Your Profile**\n` +
                `\nBalance: **₹ ${user.balance.toFixed(2)}**\n` +
                `Rollover Progress: **₹ ${user.currentBetRollover.toFixed(2)} / ₹ ${(user.lastDepositAmount * config.WITHDRAWAL_ROLLOVER_MULTIPLIER).toFixed(2)}**\n` +
                `Points: ${user.points}`, 
                { parse_mode: 'Markdown' }
            );
            break;
        case '🎁 Share & Earn':
            // ... (handleShareAndEarn logic here) ...
            bot.sendMessage(chatId, "Share logic coming soon.");
            break;
        default:
            // Ignore other messages when idle
            break;
    }
});


// --- STATE INPUT IMPLEMENTATIONS ---

// DEPOSIT FLOW

async function handleDepositAmountInput(chatId, user, text) {
    const amount = parseInt(text);

    if (isNaN(amount) || amount < 100) {
        bot.sendMessage(chatId, "❌ Invalid amount. Minimum deposit is ₹ 100.");
        return;
    }

    const method = user.tempData.method;
    const details = (method === 'upi') 
        ? `**UPI ID:** \`${config.BANK_DETAILS.UPI_ID}\` (Owner Name)` 
        : `**Bank Name:** ${config.BANK_DETAILS.BANK_NAME}\n**A/C:** ${config.BANK_DETAILS.ACCOUNT_NUMBER}\n**IFSC:** ${config.BANK_DETAILS.IFSC_CODE}`;
    
    // Set state to waiting for UTR
    await User.updateOne({ telegramId: chatId }, { $set: { 
        state: 'waiting_for_deposit_utr',
        tempData: { method, amount }
    }});

    bot.sendMessage(chatId, 
        `✅ Deposit initiated for **₹ ${amount}.00**.\n\n` +
        `**1. Pay this exact amount to:**\n${details}\n\n` +
        `**2. After paying, send the 12-digit UTR/Reference ID from your payment app here.**\n\n` +
        `*Your wallet will be credited once confirmed by the admin.*`,
        { parse_mode: 'Markdown' }
    );
}

async function handleDepositUTRInput(chatId, user, text) {
    const utr = text.trim();

    if (utr.length < 10) { 
        bot.sendMessage(chatId, "❌ Invalid UTR/Reference ID. Please re-enter the full ID.");
        return;
    }
    
    const { amount, method } = user.tempData;
    const transactionId = Math.random().toString(36).substring(2, 12).toUpperCase();
    
    // 1. Create PENDING Transaction
    await Transaction.create({
        transactionId,
        telegramId: chatId,
        type: 'Deposit',
        amount,
        status: 'Pending',
        utr,
        method
    });
    
    // 2. Clear the user state
    await User.updateOne({ telegramId: chatId }, { $set: { state: 'idle', tempData: {} } });
    
    // 3. Notify Admin Group (Manual Confirmation)
    const adminMessage = 
        `🚨 **NEW PENDING DEPOSIT**\n` +
        `----------------------------------\n` +
        `👤 **User:** ${user.firstName} (@${user.username || 'N/A'})\n` +
        `💰 **Amount:** ₹ ${amount}.00 (${method.toUpperCase()})\n` +
        `🔗 **UTR/Ref ID:** \`${utr}\`\n` +
        `#️⃣ **Txn ID:** \`${transactionId}\`\n`;
        
    const adminOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: `✅ CONFIRM Deposit of ₹ ${amount}`, callback_data: `admin_confirm_deposit_${transactionId}` }]
            ]
        }
    };
    
    await bot.sendMessage(config.ADMIN_GROUP_CHAT_ID, adminMessage, adminOptions);
    
    // 4. Notify User
    bot.sendMessage(chatId, `✅ Your deposit is **PENDING** confirmation.\nRef ID: \`${transactionId}\`. You will be notified shortly.`, { parse_mode: 'Markdown' });
}


// WITHDRAWAL FLOW

async function handleWithdrawalAmountInput(chatId, user, text) {
    const amount = parseInt(text);

    if (isNaN(amount) || amount < config.MIN_WITHDRAWAL_AMOUNT) {
        bot.sendMessage(chatId, `❌ Invalid amount. Minimum withdrawal is ₹ ${config.MIN_WITHDRAWAL_AMOUNT}.`);
        return;
    }
    
    // Rollover Enforcement Logic (Recalled from saved information)
    const requiredRollover = user.lastDepositAmount * config.WITHDRAWAL_ROLLOVER_MULTIPLIER;
    const isRolloverMet = user.currentBetRollover >= requiredRollover;

    if (!isRolloverMet && requiredRollover > 0) {
        const remainingRollover = requiredRollover - user.currentBetRollover;
        // Obscuring Rollover Logic: Provide a generic error without exact calculation details
        // to prevent users from calculating the exact turnover needed.
        const errorMessage = `❌ Withdrawal Blocked. You must place bets equal to your last deposit amount before withdrawing. You have a remaining rollover requirement. Please play more to withdraw.`;
        
        bot.sendMessage(chatId, errorMessage);
        await User.updateOne({ telegramId: chatId }, { $set: { state: 'idle', tempData: {} } });
        return; 
    }
    
    if (amount > user.balance) {
        bot.sendMessage(chatId, `❌ Insufficient balance. Your current balance is ₹ ${user.balance.toFixed(2)}.`);
        return;
    }

    // Amount is valid and rollover is met. Proceed to ask for details.
    const { method } = user.tempData;
    const nextState = (method === 'bank') ? 'waiting_for_withdrawal_detail_1' : 'waiting_for_withdrawal_detail_1'; // Both start the same
    
    await User.updateOne({ telegramId: chatId }, { $set: { 
        state: nextState,
        tempData: { method, amount }
    }});

    // Prompt the first piece of required information
    const prompt = (method === 'bank') 
        ? "Please enter the **Account Holder Name** for your Bank Account."
        : "Please enter the **Mobile Number** linked to your UPI ID.";
        
    bot.sendMessage(chatId, prompt, { parse_mode: 'Markdown' });
}

async function handleWithdrawalDetailsInput(chatId, user, text) {
    const data = user.tempData;
    const nextState = user.state;

    // This is a simple two-step form flow, can be expanded for more bank fields
    if (nextState === 'waiting_for_withdrawal_detail_1') {
        const detail = text.trim();
        let prompt;
        
        if (data.method === 'bank') {
            data.holderName = detail;
            prompt = "Next, enter your **Bank Account Number**.";
            await User.updateOne({ telegramId: chatId }, { $set: { state: 'waiting_for_withdrawal_detail_2', tempData: data } });
        } else { // UPI
            data.mobileNumber = detail;
            prompt = "Next, enter your **Full UPI ID** (e.g., name@bank).";
            await User.updateOne({ telegramId: chatId }, { $set: { state: 'waiting_for_withdrawal_detail_2', tempData: data } });
        }
        bot.sendMessage(chatId, prompt, { parse_mode: 'Markdown' });
    } 
    
    else if (nextState === 'waiting_for_withdrawal_detail_2') {
        const detail = text.trim();
        
        if (data.method === 'bank') {
            data.accountNumber = detail;
            // For simplicity, we are skipping IFSC and taking details from DB in next phase
            await processFinalWithdrawal(chatId, user, data);
        } else { // UPI
            data.upiId = detail;
            await processFinalWithdrawal(chatId, user, data);
        }
    }
}

async function processFinalWithdrawal(chatId, user, data) {
    // 1. Deduct funds and log transaction (Withdrawal Blocking Logic - Funds Deduction)
    const withdrawalAmount = data.amount;
    const transactionId = Math.random().toString(36).substring(2, 12).toUpperCase();

    // Deduct from wallet and save the details for future withdrawals
    await User.updateOne({ telegramId: chatId }, {
        $inc: { balance: -withdrawalAmount },
        $set: { 
            state: 'idle', 
            tempData: {},
            withdrawalDetails: (data.method === 'bank') 
                ? { holderName: data.holderName, accountNumber: data.accountNumber } 
                : { upiId: data.upiId }
        }
    });

    // Create PENDING Withdrawal Transaction
    await Transaction.create({
        transactionId,
        telegramId: chatId,
        type: 'Withdrawal',
        amount: withdrawalAmount,
        status: 'Processing', // Use 'Processing' to indicate funds are held
        method: data.method,
        // Save details for admin reference
        selection: JSON.stringify(data)
    });
    
    // 2. Notify Admin Group (Manual Payout)
    const adminMessage = 
        `💸 **NEW WITHDRAWAL REQUEST**\n` +
        `----------------------------------\n` +
        `👤 **User:** ${user.firstName} (@${user.username || 'N/A'})\n` +
        `💰 **Amount:** ₹ ${withdrawalAmount}.00 (${data.method.toUpperCase()})\n` +
        `#️⃣ **Txn ID:** \`${transactionId}\`\n` +
        `**PAYOUT DETAILS:**\n` +
        (data.method === 'bank' 
            ? `Holder: ${data.holderName}\nA/C: ${data.accountNumber}`
            : `UPI ID: ${data.upiId}`) +
        `\n----------------------------------\n\n`;

    // Admin options to finalize the payout
    const adminOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: `✅ PAYOUT CONFIRMED (Sent)`, callback_data: `admin_confirm_withdrawal_${transactionId}` }]
                // Add a "REJECT/REFUND" button here if needed
            ]
        }
    };
    
    await bot.sendMessage(config.ADMIN_GROUP_CHAT_ID, adminMessage, adminOptions);
    
    // 3. Notify User
    bot.sendMessage(chatId, `✅ Your withdrawal of **₹ ${withdrawalAmount}.00** is now being processed.\nRef ID: \`${transactionId}\`\n\nThe funds have been deducted from your wallet and will be transferred shortly.`, { parse_mode: 'Markdown' });
}


// --- ADMIN CALLBACK HANDLERS ---

bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;

    await bot.answerCallbackQuery(callbackQuery.id);
    
    // --- ADMIN ACTIONS (Must be in Admin Chat) ---
    if (chatId.toString() === config.ADMIN_GROUP_CHAT_ID.toString()) {
        if (action.startsWith('admin_confirm_deposit_')) {
            const transactionId = action.substring('admin_confirm_deposit_'.length);
            
            // Find and update the transaction and user balance
            const txn = await Transaction.findOneAndUpdate(
                { transactionId, status: 'Pending' }, 
                { $set: { status: 'Success', confirmedBy: callbackQuery.from.username } }
            );

            if (txn) {
                // Credit user wallet and reset rollover for enforcement
                await User.updateOne(
                    { telegramId: txn.telegramId }, 
                    { $inc: { balance: txn.amount }, $set: { lastDepositAmount: txn.amount, currentBetRollover: 0.00 } }
                );
                await bot.sendMessage(txn.telegramId, `🎉 **Deposit of ₹ ${txn.amount} CONFIRMED!** Your wallet has been credited.`, { parse_mode: 'Markdown' });
                await bot.editMessageText(`✅ **CONFIRMED** Deposit of ₹ ${txn.amount} by Admin @${callbackQuery.from.username}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            }
            return;
        } 
        
        else if (action.startsWith('admin_confirm_withdrawal_')) {
            const transactionId = action.substring('admin_confirm_withdrawal_'.length);
            
            // Update withdrawal status to final success
            const txn = await Transaction.findOneAndUpdate(
                { transactionId, status: 'Processing' }, 
                { $set: { status: 'Success', confirmedBy: callbackQuery.from.username } }
            );

            if (txn) {
                await bot.sendMessage(txn.telegramId, `✅ **Withdrawal of ₹ ${txn.amount} CONFIRMED!** The payment has been sent to your account.`, { parse_mode: 'Markdown' });
                await bot.editMessageText(`💸 **CONFIRMED** Withdrawal Payout of ₹ ${txn.amount} by Admin @${callbackQuery.from.username}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
            }
            return;
        }
    }
    
    // --- USER ACTIONS (Standard Callbacks) ---
    
    const user = await initializeUser(callbackQuery);
    
    // Remove the inline keyboard to keep the chat clean
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
    
    switch (action) {
        case 'deposit_bank':
            await User.updateOne({ telegramId: user.telegramId }, { $set: { state: 'waiting_for_deposit_amount', tempData: { method: 'bank' } } });
            bot.sendMessage(chatId, "Please enter the **exact amount** you wish to deposit (min ₹ 100):");
            break;
            
        case 'deposit_upi':
            await User.updateOne({ telegramId: user.telegramId }, { $set: { state: 'waiting_for_deposit_amount', tempData: { method: 'upi' } } });
            bot.sendMessage(chatId, "Please enter the **exact amount** you wish to deposit (min ₹ 100):");
            break;

        case 'withdrawal_bank':
            await User.updateOne({ telegramId: user.telegramId }, { $set: { state: 'waiting_for_withdrawal_amount', tempData: { method: 'bank' } } });
            bot.sendMessage(chatId, `Your balance: ₹ ${user.balance.toFixed(2)}. Enter the amount you wish to withdraw (min ₹ ${config.MIN_WITHDRAWAL_AMOUNT}):`);
            break;
            
        case 'withdrawal_upi':
            await User.updateOne({ telegramId: user.telegramId }, { $set: { state: 'waiting_for_withdrawal_amount', tempData: { method: 'upi' } } });
            bot.sendMessage(chatId, `Your balance: ₹ ${user.balance.toFixed(2)}. Enter the amount you wish to withdraw (min ₹ ${config.MIN_WITHDRAWAL_AMOUNT}):`);
            break;
    }
});


// --- Webhook Export for Vercel ---
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(200).send('OK');
        return;
    }
    try {
        const update = req.body;
        bot.processUpdate(update);
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing update:', error.message);
        res.status(500).send('Error');
    }
};