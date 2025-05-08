/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable no-console */
// eslint-disable-next-line import/no-extraneous-dependencies
const { run } = require('jest-cli')

async function runTests() {
  try {
    // Check if a specific test path was provided as an argument
    const args = process.argv.slice(2)
    const specificTestPath = args[0]
    // Extract any additional arguments (skip the first one if it's a test path)
    const additionalArgs = specificTestPath ? args.slice(1) : args

    if (specificTestPath) {
      // Run only the specific test path with any additional arguments
      console.log(`Running specific test: ${specificTestPath}`)
      await run([specificTestPath, '--forceExit=true', ...additionalArgs])
      return
    }

    // No specific path provided, run the default sequence

    // Run the portfolio test first in isolation. This is required
    // to ensure that the 'batching works' test doesn't intercept requests
    // from other tests.
    console.log('Running portfolio test in isolation...')
    await run(['src/libs/portfolio/portfolio.test.ts', ...additionalArgs])

    // Run remaining tests in parallel
    console.log('Running all remaining tests...')
    await run([
      '--forceExit=true',
      '--testPathIgnorePatterns=src/libs/portfolio/portfolio.test.ts',
      ...additionalArgs
    ])
  } catch (error) {
    console.error('Test execution failed:', error)
    process.exit(1)
  }
}

runTests()
