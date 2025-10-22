// api/models/Transaction.js

const mongoose = require('mongoose');
const { Schema } = mongoose;

const TransactionSchema = new Schema({
    transactionId: { type: String, required: true, unique: true },
    telegramId: { type: Number, required: true, ref: 'User' },
    type: { 
        type: String, 
        enum: ['Deposit', 'Withdrawal', 'Bet', 'Win', 'Referral'],
        required: true 
    },
    amount: { type: Number, required: true },
    
    // Status and Proof for Deposits/Withdrawals
    status: {
        type: String,
        enum: ['Pending', 'Success', 'Failed', 'Processing'],
        default: 'Pending'
    },
    utr: { type: String }, // For deposit tracking
    method: { type: String }, // 'Bank', 'UPI', 'Game'
    
    // Used for Withdrawal/Bet
    selection: { type: String }, 

    createdAt: { type: Date, default: Date.now },
    confirmedBy: { type: String }, // Admin username for manual confirmation
});

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', TransactionSchema);