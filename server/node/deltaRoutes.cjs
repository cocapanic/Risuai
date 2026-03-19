/**
 * Fork: Delta (block-level) save/load routes.
 * Each RisuSave block (root, presets, modules, individual characters)
 * is stored as a separate file under save/blocks/.
 * A manifest tracks block names and their content hashes.
 *
 * This module is loaded by server.cjs via init() — if it fails to load,
 * the server continues normally without delta support.
 */

const path = require('path');

let _checkAuth, _savePath, _fs, _path;
let blocksDir;

function init(app, checkAuth, savePath, fs, nodePath) {
    _checkAuth = checkAuth;
    _savePath = savePath;
    _fs = fs;
    _path = nodePath;
    blocksDir = path.join(savePath, 'blocks');

    // Ensure blocks directory exists
    const { mkdirSync, existsSync } = require('fs');
    if (!existsSync(blocksDir)) {
        mkdirSync(blocksDir, { recursive: true });
    }

    const hexRegex = /^[0-9a-fA-F]+$/;
    function isValidBlockName(name) {
        // Block names are hex-encoded UTF-8 strings
        return typeof name === 'string' && name.length > 0 && name.length < 512 && hexRegex.test(name);
    }

    // --- Feature detection ---
    app.get('/api/delta/enabled', (req, res) => {
        res.json({ enabled: true });
    });

    // --- Write a single block ---
    app.post('/api/delta/write-block', async (req, res, next) => {
        if (!await _checkAuth(req, res)) return;

        const blockName = req.headers['block-name'];
        const blockHash = req.headers['block-hash'] || '';

        if (!blockName || !isValidBlockName(blockName)) {
            return res.status(400).json({ error: 'Invalid block-name header' });
        }

        try {
            await _fs.writeFile(path.join(blocksDir, blockName), req.body);
            // Store hash as a sidecar file for quick comparison
            if (blockHash) {
                await _fs.writeFile(path.join(blocksDir, blockName + '.hash'), blockHash, 'utf-8');
            }
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    // --- Read a single block ---
    app.get('/api/delta/read-block', async (req, res, next) => {
        if (!await _checkAuth(req, res)) return;

        const blockName = req.headers['block-name'];

        if (!blockName || !isValidBlockName(blockName)) {
            return res.status(400).json({ error: 'Invalid block-name header' });
        }

        try {
            const filePath = path.join(blocksDir, blockName);
            const { existsSync } = require('fs');
            if (!existsSync(filePath)) {
                return res.status(404).json({ error: 'Block not found' });
            }
            res.setHeader('Content-Type', 'application/octet-stream');

            // Include hash header if available
            const hashPath = filePath + '.hash';
            if (existsSync(hashPath)) {
                const hash = await _fs.readFile(hashPath, 'utf-8');
                res.setHeader('block-hash', hash);
            }

            res.sendFile(filePath);
        } catch (error) {
            next(error);
        }
    });

    // --- Write manifest (small JSON listing all blocks + hashes) ---
    app.post('/api/delta/write-manifest', async (req, res, next) => {
        if (!await _checkAuth(req, res)) return;

        try {
            const manifestPath = path.join(blocksDir, '__manifest.json');
            const data = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            await _fs.writeFile(manifestPath, data, 'utf-8');
            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    // --- Read manifest ---
    app.get('/api/delta/read-manifest', async (req, res, next) => {
        if (!await _checkAuth(req, res)) return;

        try {
            const manifestPath = path.join(blocksDir, '__manifest.json');
            const { existsSync } = require('fs');
            if (!existsSync(manifestPath)) {
                return res.status(404).json({ error: 'Manifest not found' });
            }
            const data = await _fs.readFile(manifestPath, 'utf-8');
            res.json(JSON.parse(data));
        } catch (error) {
            next(error);
        }
    });

    // --- Delete a block ---
    app.delete('/api/delta/remove-block', async (req, res, next) => {
        if (!await _checkAuth(req, res)) return;

        const blockName = req.headers['block-name'];

        if (!blockName || !isValidBlockName(blockName)) {
            return res.status(400).json({ error: 'Invalid block-name header' });
        }

        try {
            const filePath = path.join(blocksDir, blockName);
            const hashPath = filePath + '.hash';
            const { existsSync } = require('fs');

            if (existsSync(filePath)) await _fs.rm(filePath);
            if (existsSync(hashPath)) await _fs.rm(hashPath);

            res.json({ success: true });
        } catch (error) {
            next(error);
        }
    });

    // --- List all blocks with hashes (for initial sync) ---
    app.get('/api/delta/list-blocks', async (req, res, next) => {
        if (!await _checkAuth(req, res)) return;

        try {
            const files = await _fs.readdir(blocksDir);
            const blocks = {};

            for (const file of files) {
                // Skip hash sidecar files and manifest
                if (file.endsWith('.hash') || file === '__manifest.json') continue;

                const hashPath = path.join(blocksDir, file + '.hash');
                const { existsSync } = require('fs');
                let hash = '';
                if (existsSync(hashPath)) {
                    hash = await _fs.readFile(hashPath, 'utf-8');
                }
                blocks[file] = hash;
            }

            res.json({ success: true, blocks });
        } catch (error) {
            next(error);
        }
    });

    console.log('[Fork] Delta save/load routes loaded');
}

module.exports = { init };
