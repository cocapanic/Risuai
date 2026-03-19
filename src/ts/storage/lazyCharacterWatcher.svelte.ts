/**
 * Fork: Lazy character loading watcher.
 *
 * Future optimization: When delta load is active, characters can be loaded
 * as stubs (name + chaId + image only) and the full data fetched on demand
 * when the user selects a character.
 *
 * Currently this module is a placeholder for the lazy loading infrastructure.
 * The delta save/load system already provides significant bandwidth savings
 * by only uploading changed blocks.
 *
 * TODO: Implement stub-based lazy loading:
 * 1. deltaLoadDb.ts loads only root + preset + modules blocks initially
 * 2. Characters stored as stubs: { chaId, name, image, __lazy: true }
 * 3. This watcher detects selectedCharID changes
 * 4. If selected character is a stub, fetch its block and replace the stub
 * 5. Svelte reactivity propagates the update automatically
 */

import { forkConfig } from './forkConfig'

let initialized = false

export function initLazyCharacterWatcher(): void {
    if (initialized) return
    if (!forkConfig.deltaSave.enabled) return

    initialized = true
    console.log('[Fork] Lazy character watcher initialized (passive mode)')
}
