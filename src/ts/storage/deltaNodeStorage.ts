/**
 * Fork: Client-side adapter for delta (block-level) save/load API.
 * Reuses NodeStorage's auth mechanism (createAuth) for JWT tokens.
 */

import { NodeStorage } from './nodeStorage'

export interface BlockManifest {
    version: number
    blocks: Record<string, string>  // blockName -> contentHash
}

export class DeltaNodeStorage {
    private nodeStorage: NodeStorage
    private _available: boolean | null = null

    constructor(nodeStorage: NodeStorage) {
        this.nodeStorage = nodeStorage
    }

    private async getAuth(): Promise<string> {
        return await this.nodeStorage.createAuth()
    }

    /** Check if the server supports delta endpoints */
    async isAvailable(): Promise<boolean> {
        if (this._available !== null) return this._available

        try {
            const res = await fetch('/api/delta/enabled', {
                headers: { 'risu-auth': await this.getAuth() }
            })
            if (res.ok) {
                const data = await res.json()
                this._available = data.enabled === true
            } else {
                this._available = false
            }
        } catch {
            this._available = false
        }

        return this._available
    }

    /** Write a single block to the server */
    async writeBlock(name: string, data: Uint8Array, hash: string): Promise<void> {
        const hexName = Buffer.from(name, 'utf-8').toString('hex')
        const res = await fetch('/api/delta/write-block', {
            method: 'POST',
            body: data,
            headers: {
                'content-type': 'application/octet-stream',
                'block-name': hexName,
                'block-hash': hash,
                'risu-auth': await this.getAuth()
            }
        })
        if (!res.ok) {
            throw new Error(`writeBlock failed: ${res.status}`)
        }
    }

    /** Read a single block from the server */
    async readBlock(name: string): Promise<{ data: Uint8Array, hash: string } | null> {
        const hexName = Buffer.from(name, 'utf-8').toString('hex')
        const res = await fetch('/api/delta/read-block', {
            method: 'GET',
            headers: {
                'block-name': hexName,
                'risu-auth': await this.getAuth()
            }
        })
        if (res.status === 404) return null
        if (!res.ok) throw new Error(`readBlock failed: ${res.status}`)

        const data = new Uint8Array(await res.arrayBuffer())
        const hash = res.headers.get('block-hash') || ''
        return { data, hash }
    }

    /** Write the manifest (block listing + hashes) */
    async writeManifest(manifest: BlockManifest): Promise<void> {
        const res = await fetch('/api/delta/write-manifest', {
            method: 'POST',
            body: JSON.stringify(manifest),
            headers: {
                'content-type': 'application/json',
                'risu-auth': await this.getAuth()
            }
        })
        if (!res.ok) throw new Error(`writeManifest failed: ${res.status}`)
    }

    /** Read the manifest */
    async readManifest(): Promise<BlockManifest | null> {
        const res = await fetch('/api/delta/read-manifest', {
            method: 'GET',
            headers: {
                'risu-auth': await this.getAuth()
            }
        })
        if (res.status === 404) return null
        if (!res.ok) throw new Error(`readManifest failed: ${res.status}`)

        return await res.json()
    }

    /** Delete a block */
    async removeBlock(name: string): Promise<void> {
        const hexName = Buffer.from(name, 'utf-8').toString('hex')
        const res = await fetch('/api/delta/remove-block', {
            method: 'DELETE',
            headers: {
                'block-name': hexName,
                'risu-auth': await this.getAuth()
            }
        })
        if (!res.ok) throw new Error(`removeBlock failed: ${res.status}`)
    }

    /** List all blocks with their hashes */
    async listBlocks(): Promise<Record<string, string>> {
        const res = await fetch('/api/delta/list-blocks', {
            method: 'GET',
            headers: {
                'risu-auth': await this.getAuth()
            }
        })
        if (!res.ok) throw new Error(`listBlocks failed: ${res.status}`)
        const data = await res.json()
        return data.blocks
    }
}
