/**
 * Fork: Delta load logic.
 * Instead of downloading the entire database.bin blob,
 * loads individual blocks from the delta API and reconstructs the Database.
 *
 * Reuses the same block binary format as RisuSaveEncoder/RisuSaveDecoder.
 */

import { DeltaNodeStorage, type BlockManifest } from './deltaNodeStorage'
import { NodeStorage } from './nodeStorage'
import { forkConfig } from './forkConfig'
import { isNodeServer } from 'src/ts/platform'
import { presetTemplate, type Database } from './database.svelte'

/** Parse a single encoded block's binary format into its content string */
async function parseBlock(data: Uint8Array): Promise<{
    type: number
    name: string
    content: string
} | null> {
    try {
        let offset = 0

        const type = data[offset]
        const compression = data[offset + 1] === 1
        offset += 2

        const nameLength = data[offset]
        offset += 1
        const name = new TextDecoder().decode(data.subarray(offset, offset + nameLength))
        offset += nameLength

        const newArrayBuf = new ArrayBuffer(4)
        new Uint8Array(newArrayBuf).set(data.slice(offset, offset + 4))
        const length = new Uint32Array(newArrayBuf)[0]
        offset += 4

        let blockData = data.subarray(offset, offset + length)

        if (compression) {
            const cs = new DecompressionStream('gzip')
            const writer = cs.writable.getWriter()
            writer.write(blockData as any)
            writer.close()
            const buf = await new Response(cs.readable).arrayBuffer()
            blockData = new Uint8Array(buf)
        }

        return {
            type,
            name,
            content: new TextDecoder().decode(blockData)
        }
    } catch (e) {
        console.error('[Fork] Failed to parse block:', e)
        return null
    }
}

// RisuSaveType enum values (mirrored from risuSave.ts to avoid import issues)
const BLOCK_TYPE = {
    CONFIG: 0,
    ROOT: 1,
    CHARACTER_WITH_CHAT: 2,
    CHAT: 3,
    BOTPRESET: 4,
    MODULES: 5,
    REMOTE: 6,
    CHARACTER_WITHOUT_CHAT: 7,
    ROOT_COMPONENT: 8,
} as const

/**
 * Try to load the database from delta blocks.
 * Returns the Database if successful, null if delta is not available or fails.
 */
export async function tryDeltaLoad(): Promise<Database | null> {
    if (!isNodeServer || !forkConfig.deltaSave.enabled) return null

    try {
        const nodeStorage = new NodeStorage()
        const deltaStorage = new DeltaNodeStorage(nodeStorage)

        if (!await deltaStorage.isAvailable()) return null

        const manifest = await deltaStorage.readManifest()
        if (!manifest || !manifest.blocks) return null

        const blockNames = Object.keys(manifest.blocks)
        if (blockNames.length === 0) return null

        console.log(`[Fork] Delta load: ${blockNames.length} blocks to load`)

        // @ts-expect-error Database has required fields, but we populate incrementally
        const db: Database = {}

        // Load and parse all blocks
        for (const blockName of blockNames) {
            try {
                const result = await deltaStorage.readBlock(blockName)
                if (!result) continue

                const parsed = await parseBlock(result.data)
                if (!parsed) continue

                switch (parsed.type) {
                    case BLOCK_TYPE.ROOT: {
                        const rootData = JSON.parse(parsed.content)
                        for (const key in rootData) {
                            if (!key.startsWith('__')) {
                                db[key] = rootData[key]
                            }
                        }
                        break
                    }
                    case BLOCK_TYPE.CHARACTER_WITH_CHAT:
                    case BLOCK_TYPE.CHARACTER_WITHOUT_CHAT: {
                        db.characters ??= []
                        db.characters.push(JSON.parse(parsed.content))
                        break
                    }
                    case BLOCK_TYPE.BOTPRESET: {
                        db.botPresets = JSON.parse(parsed.content)
                        break
                    }
                    case BLOCK_TYPE.MODULES: {
                        db.modules = JSON.parse(parsed.content)
                        break
                    }
                    case BLOCK_TYPE.CONFIG: {
                        // ignore
                        break
                    }
                    case BLOCK_TYPE.ROOT_COMPONENT: {
                        const componentData = JSON.parse(parsed.content)
                        db[componentData.key] = componentData.data
                        break
                    }
                }
            } catch (e) {
                console.warn(`[Fork] Failed to load block ${blockName}:`, e)
            }
        }

        // Fix botpreset bugs (same as original decoder)
        if (!Array.isArray(db.botPresets) || db.botPresets.length === 0) {
            db.botPresets = [presetTemplate]
            db.botPresetsId = 0
        }

        db.characters ??= []

        console.log(`[Fork] Delta load complete: ${db.characters.length} characters loaded`)
        return db
    } catch (e) {
        console.error('[Fork] Delta load failed:', e)
        return null
    }
}
