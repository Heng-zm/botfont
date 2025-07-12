// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { logger, getUserInfo } = require('./services/logger');
const db = require('./services/dbService');
const { initializeCache } = require('./services/fontService');
const { startAdminPanel } = require('./adminPanel');
const messageHandler = require('./handlers/messageHandler');
const callbackHandler = require('./handlers/callbackHandler');
const inlineHandler = require('./handlers/inlineHandler');
const adminHandler = require('./handlers/adminHandler');

const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;

if (!token || !ADMIN_ID) { logger.error("FATAL: Missing TELEGRAM_BOT_TOKEN or ADMIN_CHAT_ID in .env file!"); process.exit(1); }

async function main() {
    await db.initializeDatabase();
    initializeCache();
    const bot = new TelegramBot(token, { polling: true });
    
    // Message Queue Worker
    let isWorkerRunning = false;
    setInterval(async () => {
        if (isWorkerRunning) return;
        isWorkerRunning = true;
        try {
            const messagesToSend = await db.popAllMessagesFromQueue();
            if (messagesToSend && messagesToSend.length > 0) {
                const broadcastTask = messagesToSend.find(m => m.isBroadcast);
                if (broadcastTask) {
                    const allUsers = await db.getAllUsers();
                    const targets = allUsers.filter(u => u.id.toString() !== ADMIN_ID && !u.is_bot);
                    await db.startBroadcastLog(broadcastTask.text, targets.length);
                    logger.warn(`Starting broadcast...`);
                    for (const user of targets) {
                        try {
                            await bot.sendMessage(user.id, broadcastTask.text, { parse_mode: 'Markdown' });
                            await db.logBroadcastResult(true, user.id);
                        } catch (error) {
                            await db.logBroadcastResult(false, user.id, error.message);
                        }
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    await db.endBroadcastLog();
                } else {
                    for (const msg of messagesToSend) {
                        if (msg.chatId) await bot.sendMessage(msg.chatId, msg.text, { parse_mode: 'Markdown' }).catch(e => logger.error(`Queued msg fail: ${e.message}`));
                    }
                }
            }
        } catch (error) { logger.error('CRITICAL Error in Message Queue Worker:', { stack: error.stack });
        } finally { isWorkerRunning = false; }
    }, 5000);

    startAdminPanel(bot);

    // Universal Middleware
    const withMiddleware = (handler) => async (updateObject) => {
        try {
            const user = getUserInfo(updateObject);
            if (!user || (user.is_bot && user.id.toString() !== ADMIN_ID)) return;
            if (await db.isUserBanned(user.id)) return logger.warn(`Blocked request from banned user`, { user });
            await db.addOrUpdateUser(user);
            handler(bot)(updateObject);
        } catch (error) { logger.error(`Error in middleware:`, { stack: error.stack }); }
    };
    
    // Route Handlers
    bot.on('message', withMiddleware((innerBot) => (msg) => { (msg.from.id.toString() === ADMIN_ID && msg.text?.startsWith('/')) ? adminHandler(innerBot)(msg) : messageHandler(innerBot)(msg); }));
    bot.on('callback_query', withMiddleware(callbackHandler));
    bot.on('inline_query', withMiddleware(inlineHandler));

    // Network Error Handling
    bot.on('polling_error', (error) => logger.error(`Polling Error: ${error.code} - ${error.message}`));
    bot.on('webhook_error', (error) => logger.error(`Webhook Error: ${error.code} - ${error.message}`));

    const shutdown = () => { logger.info("Shutting down..."); bot.stopPolling().then(() => process.exit(0)); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('✅ Font Sharer Bot is fully operational.');
}

main().catch(err => logger.error('FATAL: Bot failed to start.', { stack: err.stack }));