/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 25000,
  moduleNameMapper: {
    '^@/(.*)$': `${__dirname}/src/$1`,
    '^@test/(.*)$': `${__dirname}/test/$1`,
    // ESM-only packages the CommonJS runtime cannot load - see the stub for why this is safe
    '^@kohaku-eth/privacy-pools$': `${__dirname}/test/mocks/privacyPoolsSdk.ts`,
    '^@fatsolutions/privacy-pools-core-circuits$': `${__dirname}/test/mocks/privacyPoolsSdk.ts`,
    '^node-fetch$': `${__dirname}/test/nodeFetchWithRelayerCustomHeaders.ts`,
    // The build the apps bundle. The Node entry tries a native module first and logs on every
    // import when it is missing.
    '^eccrypto$': require.resolve('eccrypto/browser.js')
  },
  // For services/validate.ts https://stackoverflow.com/a/61785012/13840636
  transform: {
    'node_modules/validator/.+\\.(j|t)sx?$': 'ts-jest'
  },
  transformIgnorePatterns: ['node_modules/(?!validator/.*)'],
  setupFiles: [
    'dotenv/config',
    `${__dirname}/test/setupRelayerCustomHeaders.ts`,
    `${__dirname}/test/silenceConsoleWarn.ts`
  ]
}
