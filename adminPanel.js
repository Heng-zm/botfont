// adminPanel.js

const express = require('express');
const http = require('http'); // Import the native http module
const { WebSocketServer } = require('ws'); // Import the WebSocket server
const fs = require('fs');
const path = require('path');
const { logger } = require('./services/logger');
const eventEmitter = require('./services/eventService');

/**
 * Starts a robust web dashboard with a real-time WebSocket connection for the bot admin.
 * @param {TelegramBot} bot The running bot instance, required for sending notifications via the message queue.
 */
function startAdminPanel(bot) {
    if (!bot) {
        logger.error("FATAL: Admin Panel was called without a bot instance. It cannot start.");
        return;
    }

    // Import services inside the function to ensure they are initialized correctly.
    const dbService = require('./services/dbService');
    const { initializeCache, getFontCache } = require('./services/fontService');
    
    const app = express();
    const server = http.createServer(app); // Create an HTTP server from the Express app
    const wss = new WebSocketServer({ server }); // Attach the WebSocket server to the HTTP server

    const PORT = process.env.ADMIN_PANEL_PORT || 3000;
    
    // Define paths directly for clarity and robustness.
    const FONT_DIR = process.env.FONT_DIRECTORY;
    const PENDING_DIR = path.join(__dirname, 'pending_fonts');
    const DB_PATH = path.join(__dirname, 'db.json');
    const LOG_PATH = path.join(__dirname, 'combined.log');

    // Middleware to parse JSON bodies from requests.
    app.use(express.json());

    // Ensure necessary directories exist at startup.
    if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR);
    if (!FONT_DIR || !fs.existsSync(FONT_DIR)) {
        logger.error(`FATAL: FONT_DIRECTORY in .env is not configured correctly or does not exist. Path: ${FONT_DIR}`);
    }

    // --- WebSocket Connection Handling ---
    wss.on('connection', ws => {
        logger.info('Admin Panel client connected via WebSocket.');
        ws.on('error', console.error);
        ws.on('close', () => logger.info('Admin Panel client disconnected.'));
    });
    
    const broadcastToClients = (data) => {
        const payload = JSON.stringify(data);
        wss.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
                client.send(payload);
            }
        });
    };

    // Listen to events from the bot logic and broadcast them to all connected clients
    eventEmitter.on('dataChanged', (data) => {
        logger.info(`Event '${data.type}' received. Broadcasting real-time update.`);
        broadcastToClients({ event: 'dataUpdate' });
    });
    eventEmitter.on('newLog', (logMessage) => {
        broadcastToClients({ event: 'newLog', message: logMessage });
    });
    
    // --- API Endpoints ---

    // GET /api/data: The main endpoint for the Dashboard view
    app.get('/api/data', async (req, res) => {
        try {
            const dbData = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) : {};
            const pendingFonts = fs.readdirSync(PENDING_DIR);
            let allLogs = fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean) : [];
            const allUsers = await dbService.getAllUsers();
            
            const logQuery = (req.query.log_search || '').toLowerCase();
            if (logQuery) {
                allLogs = allLogs.filter(log => log.toLowerCase().includes(logQuery));
            }
            const finalLogs = allLogs.slice(-200).reverse();

            res.json({
                stats: {
                    totalFonts: getFontCache().length,
                    pendingCount: pendingFonts.length,
                    bannedCount: Object.keys(dbData.bannedUsers || {}).length,
                    totalUsers: allUsers.length,
                },
                bannedUsers: Object.entries(dbData.bannedUsers || {}).map(([id, data]) => ({ id, ...data })),
                pendingFonts: pendingFonts,
                logs: finalLogs,
            });
        } catch (error) {
            logger.error('Failed to read data for admin panel', { stack: error.stack });
            res.status(500).json({ error: "Internal Server Error while reading data files." });
        }
    });

    // GET /api/broadcast/status: Get the status of the last broadcast.
    app.get('/api/broadcast/status', (req, res) => {
        try {
            const status = dbService.getBroadcastStatus();
            res.json(status);
        } catch (error) {
            logger.error('Failed to get broadcast status:', { stack: error.stack });
            res.status(500).json({ error: 'Could not get broadcast status.' });
        }
    });

    // GET /api/users: Endpoint for the "All Users" tab with search.
    app.get('/api/users', async (req, res) => {
        try {
            const allUsers = await dbService.getAllUsers();
            const bannedList = await dbService.getBanList();
            const bannedIds = new Set(bannedList.map(u => u.id));
            let users = allUsers.map(user => ({ ...user, isBanned: bannedIds.has(user.id.toString()) }));
            const searchQuery = (req.query.search || '').toLowerCase();
            if (searchQuery) {
                users = users.filter(user => 
                    Object.values(user).some(val => String(val).toLowerCase().includes(searchQuery))
                );
            }
            users.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
            res.json({ users });
        } catch (error) {
            logger.error('Failed to get user list for admin panel', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve user list.' });
        }
    });

    // GET /api/user/:id: Find a single user.
    app.get('/api/user/:id', async (req, res) => {
        const user = dbService.findUserById(req.params.id);
        if (user) {
            const isBanned = await dbService.isUserBanned(req.params.id);
            res.json({ ...user, isBanned });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    });

    // POST endpoints for actions. These queue tasks for the bot to handle.
    app.post('/api/message', async (req, res) => {
        const { userId, message } = req.body;
        if (!userId || !message) return res.status(400).json({ error: 'userId and message are required' });
        await dbService.addMessageToQueue(userId, message);
        res.json({ success: true, message: `Message queued for user ${userId}` });
    });
    
    app.post('/api/broadcast', async (req, res) => {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });
        await dbService.addMessageToQueue(null, message, true);
        res.json({ success: true, message: `Broadcast has been queued!` });
    });

    app.post('/api/ban', async (req, res) => {
        const { userId, reason } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });
        await dbService.banUser(Number(userId), reason || 'Banned from Admin Panel');
        res.json({ success: true });
    });

    app.post('/api/unban', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });
        await dbService.unbanUser(Number(userId));
        res.json({ success: true });
    });

    app.post('/api/approve', async (req, res) => {
        const { fileName } = req.body;
        if (!fileName) return res.status(400).json({ error: 'fileName is required' });
        const pendingFilePath = path.join(PENDING_DIR, fileName);
        if (!fs.existsSync(pendingFilePath)) return res.status(404).json({ error: 'File not found in pending directory.' });
        const originalFileName = fileName.split('_').slice(2).join('_');
        const uploaderId = fileName.split('_')[1];
        try {
            fs.copyFileSync(pendingFilePath, path.join(FONT_DIR, originalFileName));
            fs.unlinkSync(pendingFilePath);
            initializeCache();
            await dbService.logUpload(uploaderId, originalFileName, 'approved');
            if (uploaderId) await dbService.addMessageToQueue(uploaderId, `🎉 ពុម្ពអក្សរ *${originalFileName}* របស់អ្នកត្រូវបាន Approve។`);
            res.json({ success: true, message: `Approved ${originalFileName}` });
        } catch (error) {
            logger.error(`ADMIN PANEL: Failed to approve font ${fileName}`, { stack: error.stack });
            res.status(500).json({ error: `Failed to move file. Check server permissions and paths. Details: ${error.message}` });
        }
    });

    app.post('/api/reject', async (req, res) => {
        const { fileName } = req.body;
        if (!fileName) return res.status(400).json({ error: 'fileName is required' });
        const pendingFilePath = path.join(PENDING_DIR, fileName);
        if (!fs.existsSync(pendingFilePath)) return res.status(404).json({ error: 'File not found' });
        const uploaderId = fileName.split('_')[1];
        const originalFileName = fileName.split('_').slice(2).join('_');
        try {
            fs.unlinkSync(pendingFilePath);
            await dbService.logUpload(uploaderId, originalFileName, 'rejected');
            logger.warn(`ADMIN PANEL ACTION: Rejected font ${originalFileName}`);
            if (uploaderId) await dbService.addMessageToQueue(uploaderId, `ℹ️ សូមអភ័យទោស, ការស្នើសុំពុម្ពអក្សរ *${originalFileName}* របស់អ្នកត្រូវបានបដិសេធ។`);
            res.json({ success: true, message: `Rejected ${originalFileName}` });
        } catch (error) {
            logger.error(`ADMIN PANEL: Failed to reject font ${fileName}`, { stack: error.stack });
            res.status(500).json({ error: 'Failed to delete file.' });
        }
    });

    // --- Static File Serving & Server Start ---
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'admin.html'));
    });
    
    // Use server.listen() to start listening on both HTTP and WebSocket protocols
    server.listen(PORT, () => {
        logger.info(`Admin Panel (HTTP & WebSocket) is running at http://localhost:${PORT}`);
    });
}

module.exports = { startAdminPanel };