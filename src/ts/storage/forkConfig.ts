/**
 * Fork-specific feature flags.
 * All fork customizations are gated behind these flags so they can be
 * disabled without removing code, and upstream merges stay clean.
 */

export interface ForkConfigOptions {
    deltaSave: {
        /** Enable block-level delta save/load instead of full-blob writes */
        enabled: boolean
    }
    /** Re-enable Plugin API 2.0 / 2.1 execution */
    pluginV2Enabled: boolean
}

const defaultConfig: ForkConfigOptions = {
    deltaSave: {
        enabled: true,
    },
    pluginV2Enabled: true,
}

function loadConfig(): ForkConfigOptions {
    try {
        const stored = localStorage.getItem('__fork_config')
        if (stored) {
            return { ...defaultConfig, ...JSON.parse(stored) }
        }
    } catch {
        // ignore parse errors
    }
    return defaultConfig
}

export const forkConfig: ForkConfigOptions = loadConfig()

/** Persist current config to localStorage */
export function saveForkConfig(config: Partial<ForkConfigOptions>): void {
    const merged = { ...forkConfig, ...config }
    Object.assign(forkConfig, merged)
    try {
        localStorage.setItem('__fork_config', JSON.stringify(merged))
    } catch {
        // storage full or unavailable
    }
}

// Set global flag for plugin v2.0 support (checked in plugins.svelte.ts)
if (forkConfig.pluginV2Enabled) {
    ;(globalThis as any).__FORK_PLUGIN_V2_ENABLED__ = true
}
