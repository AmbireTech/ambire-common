// eslint-disable-next-line import/no-extraneous-dependencies
const { run } = require('jest-cli')

async function runTests() {
  try {
    // Run the portfolio test first in isolation. This is required
    // to ensure that the 'batching works' test doesn't intercept requests
    // from other tests.
    await run(['src/libs/portfolio/portfolio.test.ts'])

    // Run remaining tests in parallel
    await run(['--forceExit=true', '--testPathIgnorePatterns=src/libs/portfolio/portfolio.test.ts'])
  } catch (error) {
    console.error('Test execution failed:', error)
    process.exit(1)
  }
}

runTests()
