// services/fontService.js

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

let fontCache = [];
// This object will store the current list a user is browsing (e.g., search results or all fonts)
let userSessionData = {};

/**
 * Reads the font directory, sorts the files, and updates the in-memory font cache.
 * This function is called on startup and on admin's /refresh command.
 */
function initializeCache() {
    logger.info("Refreshing font cache...");
    try {
        const fontDirectory = process.env.FONT_DIRECTORY;
        if (!fs.existsSync(fontDirectory)) {
            logger.error(`Font directory not found: ${fontDirectory}`);
            fontCache = [];
            return;
        }
        fontCache = fs.readdirSync(fontDirectory)
            .filter(file => /\.(ttf|otf)$/i.test(file)) // Filter for .ttf and .otf files
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })); // Natural sort
        
        logger.info(`Cache updated. Found ${fontCache.length} fonts.`);
    } catch (error) {
        logger.error(`Failed to refresh font cache: ${error.message}`);
        fontCache = []; // Ensure cache is empty on error
    }
}

/**
 * Returns the full list of cached font filenames.
 * @returns {string[]}
 */
function getFontCache() {
    return fontCache;
}

/**
 * Stores a list of fonts for a specific user's session.
 * @param {number} chatId
 * @param {string[]} files
 */
function setUserSession(chatId, files) {
    userSessionData[chatId] = files;
}

/**
 * Retrieves the list of fonts for a specific user's session.
 * @param {number} chatId
 * @returns {string[] | undefined}
 */
function getUserSession(chatId) {
    return userSessionData[chatId];
}

// Initial cache load on startup
initializeCache();

module.exports = {
    initializeCache,
    getFontCache,
    setUserSession,
    getUserSession,
};