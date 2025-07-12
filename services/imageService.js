// services/imageService.js

const { createCanvas, registerFont } = require('canvas');
const path = require('path');
const strings = require('../localization');
const { logger } = require('./logger');

// --- Fallback Font Registration ---
let fallbackFontFamily = 'sans-serif'; // Use a generic system font as a last resort.
const fallbackFontPath = path.join(__dirname, '..', 'assets', 'KhmerOSSiemreap-Regular.ttf');

try {
    registerFont(fallbackFontPath, { family: 'KhmerOSFallback' });
    fallbackFontFamily = 'KhmerOSFallback'; // Only assign the custom name if registration succeeds.
    logger.info('Khmer fallback font registered successfully.');
} catch (error) {
    logger.warn(`Could not register Khmer fallback font. Previews may not show Khmer text correctly. Error: ${error.message}`);
}

/**
 * --- NEW: Creates a standard error image when a font fails to load. ---
 * @param {string} fontName - The name of the font that failed to load.
 * @returns {Buffer} A PNG image buffer showing an error message.
 */
function createErrorImage(fontName) {
    const canvasWidth = 700;
    const canvasHeight = 220;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // Draw a light red background to indicate an error
    ctx.fillStyle = '#2d2122'; // Dark red-ish background
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.strokeStyle = 'var(--danger-color)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvasWidth, canvasHeight);

    // Draw the error message using the reliable fallback font
    ctx.fillStyle = '#ef4444'; // Danger color text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Use the error text from localization
    const lines = strings.errorImageText(fontName).split('\n');
    ctx.font = `bold 28px "${fallbackFontFamily}"`;
    ctx.fillText(lines[0], canvasWidth / 2, canvasHeight / 2 - 15);
    
    if (lines[1]) {
        ctx.font = `20px "Fira Code", monospace`;
        ctx.fillStyle = '#f87171';
        ctx.fillText(lines[1], canvasWidth / 2, canvasHeight / 2 + 20);
    }
    
    return canvas.toBuffer('image/png');
}

/**
 * Generates a high-quality PNG buffer showing a preview of a given font.
 * It is now robust against font registration failures.
 * 
 * @param {string} fontPath - Absolute path to the .ttf or .otf file.
 * @param {string} fontName - The name of the font to display.
 * @returns {Buffer} A PNG image buffer of the preview, or an error image buffer on failure.
 */
function generateFontPreview(fontPath, fontName) {
    let targetFontFamily;

    // --- THE FIX IS HERE: Wrap font registration in a try...catch block. ---
    try {
        const uniqueFamilyName = `TargetFont-${Date.now()}-${Math.random()}`;
        registerFont(fontPath, { family: uniqueFamilyName });
        targetFontFamily = uniqueFamilyName;
    } catch (error) {
        logger.error(`Could not register font: ${fontName}. It might be corrupted or unsupported.`, { error: error.message });
        // If registration fails, return the specially crafted error image.
        return createErrorImage(fontName);
    }

    const canvasWidth = 700;
    const canvasHeight = 220;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // 1. Draw a clean background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 2. Safely construct the font stack for Pango.
    const fontStack = [
        `"${targetFontFamily}"`, // It's guaranteed to exist if we passed the try...catch
        `"${fallbackFontFamily}"`,
        'sans-serif'
    ].join(', ');

    // 3. Draw the font's own name at the top
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#212529';
    ctx.font = `bold 26px ${fontStack}`;
    ctx.fillText(fontName, 25, 20);

    // 4. Draw a separator line
    ctx.strokeStyle = '#DEE2E6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(25, 65);
    ctx.lineTo(canvasWidth - 25, 65);
    ctx.stroke();

    // 5. Draw the Khmer and Latin sample text
    ctx.font = `42px ${fontStack}`;
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';
    ctx.fillText(strings.previewTextKhmer, 25, 115);
    ctx.font = `32px ${fontStack}`;
    ctx.fillStyle = '#495057';
    ctx.fillText(strings.previewTextLatin, 25, 175);

    // 6. Draw a subtle watermark
    ctx.font = `14px "sans-serif"`;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(strings.previewWatermark, canvasWidth - 20, canvasHeight - 15);

    return canvas.toBuffer('image/png');
}

module.exports = { 
    generateFontPreview
};