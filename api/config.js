// api/config.js

const config = {
    // General
    BOT_TOKEN: process.env.BOT_TOKEN,
    ADMIN_GROUP_CHAT_ID: process.env.ADMIN_GROUP_CHAT_ID,
    GAME_APP_URL: 'https://' + process.env.VERCEL_URL + '/public/index.html',

    // Database
    DATABASE_URL: process.env.DATABASE_URL, 

    // Manual Bank Details
    BANK_DETAILS: {
        HOLDER_NAME: process.env.BANK_HOLDER_NAME || 'John Doe',
        BANK_NAME: process.env.BANK_NAME || 'State Bank of India',
        ACCOUNT_NUMBER: process.env.BANK_ACCOUNT_NUMBER || '123456789012',
        IFSC_CODE: process.env.BANK_IFSC_CODE || 'SBIN0001234',
        UPI_ID: process.env.STATIC_UPI_ID || 'yourstaticupi@bank', // Static UPI for semi-manual deposits
    },

    // Withdrawal Constraints (Recalled from saved information)
    MIN_WITHDRAWAL_AMOUNT: 500,
    WITHDRAWAL_ROLLOVER_MULTIPLIER: 1, // User must bet this times the deposit amount
};

module.exports = config;