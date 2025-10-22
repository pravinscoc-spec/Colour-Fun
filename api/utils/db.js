// api/utils/db.js

const mongoose = require('mongoose');
const config = require('../config');

let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb) {
        return cachedDb;
    }
    
    // Connect to MongoDB
    const db = await mongoose.connect(config.DATABASE_URL, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        bufferCommands: false,
        bufferMaxEntries: 0,
    });
    
    cachedDb = db;
    return cachedDb;
}

module.exports = connectToDatabase;