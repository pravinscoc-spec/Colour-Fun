// api/models/User.js

const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
    telegramId: { type: Number, required: true, unique: true },
    username: { type: String, trim: true },
    firstName: { type: String },
    
    // Wallet
    balance: { type: Number, default: 0.00 },
    points: { type: Number, default: 0 },
    
    // Withdrawal Details
    withdrawalDetails: {
        holderName: String,
        accountNumber: String,
        ifscCode: String,
        upiId: String
    },

    // Rollover Tracking (Crucial for Withdrawal Enforcement)
    lastDepositAmount: { type: Number, default: 0.00 },
    currentBetRollover: { type: Number, default: 0.00 }, // Total value of bets placed since last deposit
    
    // State machine tracking
    state: {
        type: String,
        enum: [
            'idle', 
            'waiting_for_deposit_amount', 
            'waiting_for_deposit_utr', 
            'waiting_for_withdrawal_amount',
            'waiting_for_withdrawal_detail_1',
            'waiting_for_withdrawal_detail_2'
        ],
        default: 'idle'
    },
    
    tempData: { type: Object, default: {} },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);