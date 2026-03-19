/**
 * Fork: Delta save logic.
 * Instead of encoding all blocks into one blob and POSTing it,
 * this module compares block hashes and only uploads changed blocks.
 *
 * It accesses RisuSaveEncoder.blocks via (encoder as any).blocks
 * since the field is TypeScript-private but accessible at runtime.
 */

import { type RisuSaveEncoder, type toSaveType } from './risuSave'
import { DeltaNodeStorage, type BlockManifest } from './deltaNodeStorage'
import { NodeStorage } from './nodeStorage'
import { forkConfig } from './forkConfig'
import { isNodeServer } from 'src/ts/platform'

let deltaStorage: DeltaNodeStorage | null = null
let cachedHashes: Record<string, string> = {}
let initialized = false

/** Compute a simple hash of a Uint8Array using SHA-256 */
async function hashBlock(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = new Uint8Array(hashBuffer)
    return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Initialize delta storage if available */
export async function initDeltaStorage(nodeStorage: NodeStorage): Promise<boolean> {
    if (!isNodeServer || !forkConfig.deltaSave.enabled) return false
    if (initialized) return deltaStorage !== null

    try {
        const ds = new DeltaNodeStorage(nodeStorage)
        const available = await ds.isAvailable()
        if (available) {
            deltaStorage = ds

            // Load existing manifest to populate cached hashes
            const manifest = await ds.readManifest()
            if (manifest) {
                cachedHashes = { ...manifest.blocks }
            }

            console.log('[Fork] Delta storage initialized')
        }
    } catch (e) {
        console.warn('[Fork] Delta storage init failed:', e)
    }

    initialized = true
    return deltaStorage !== null
}

/**
 * Perform a delta save: only upload blocks whose content has changed.
 * Falls back to the provided fallback function if delta is unavailable.
 */
export async function deltaSave(
    encoder: RisuSaveEncoder,
): Promise<boolean> {
    if (!deltaStorage) return false

    try {
        // Access the private blocks field at runtime
        const blocks: Record<string, Uint8Array> = (encoder as any).blocks
        if (!blocks || !blocks['config']) return false

        const newManifest: BlockManifest = {
            version: 1,
            blocks: {}
        }

        let uploadedCount = 0
        let skippedCount = 0

        // Compare each block's hash and upload only changed ones
        for (const [name, data] of Object.entries(blocks)) {
            const hash = await hashBlock(data)
            newManifest.blocks[name] = hash

            if (cachedHashes[name] === hash) {
                skippedCount++
                continue
            }

            await deltaStorage.writeBlock(name, data, hash)
            cachedHashes[name] = hash
            uploadedCount++
        }

        // Remove blocks that no longer exist (deleted characters)
        for (const name of Object.keys(cachedHashes)) {
            if (!blocks[name]) {
                try {
                    await deltaStorage.removeBlock(name)
                } catch { /* ignore removal errors */ }
                delete cachedHashes[name]
            }
        }

        // Write manifest
        await deltaStorage.writeManifest(newManifest)

        if (uploadedCount > 0) {
            console.log(`[Fork] Delta save: ${uploadedCount} blocks uploaded, ${skippedCount} skipped`)
        }

        return true
    } catch (e) {
        console.error('[Fork] Delta save failed, will retry next cycle:', e)
        return false
    }
}

/** Check if delta save is active */
export function isDeltaActive(): boolean {
    return deltaStorage !== null
}
