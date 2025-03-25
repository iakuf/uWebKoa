import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
    // Removed the node plugin since it's not available
    plugins: [],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@tests': path.resolve(__dirname, './tests')
        }
    },
    test: {
        globals: true,
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'istanbul'
        }
    }
})