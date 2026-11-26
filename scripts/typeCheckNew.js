/**
 * Runs the type check and fails only on errors that are not in .tsc-baseline.json of the current
 * folder. Extra arguments go to tsc, e.g. `--project tsconfig.typecheck.json`, and the baseline
 * file itself decides whether messages are compared.
 * tsc-baseline skips errors without a file, such as a missing type package, and passes on empty
 * output, so this fails on those and on a tsc crash instead of letting the check pass unseen.
 */
const { spawnSync } = require('child_process')

const TSC_EXIT_NO_ERRORS = 0
// tsc --noEmit exits with this code whenever it reports any error, including a global one
const TSC_EXIT_ERRORS_REPORTED = 2
const EXIT_FAILURE = 1
const GLOBAL_ERROR_PREFIX = 'error TS'
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

const runTsc = () => {
  const tsc = spawnSync('tsc', ['--noEmit', ...process.argv.slice(2)], {
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: true
  })
  if (tsc.error) throw tsc.error

  return tsc
}

const getGlobalErrors = (output) =>
  output.split('\n').filter((line) => line.startsWith(GLOBAL_ERROR_PREFIX))

const tsc = runTsc()
if (tsc.status !== TSC_EXIT_NO_ERRORS && tsc.status !== TSC_EXIT_ERRORS_REPORTED) {
  process.stdout.write(tsc.stdout)
  process.stderr.write(tsc.stderr)
  console.error(`tsc stopped with exit code ${tsc.status} and signal ${tsc.signal}`)
  process.exit(EXIT_FAILURE)
}

const globalErrors = getGlobalErrors(tsc.stdout)
if (globalErrors.length) {
  console.error(`tsc reported errors that the baseline cannot check:\n${globalErrors.join('\n')}`)
  process.exit(EXIT_FAILURE)
}

const baselineCheck = spawnSync('tsc-baseline', ['check'], {
  input: tsc.stdout,
  stdio: ['pipe', 'inherit', 'inherit'],
  shell: true
})
if (baselineCheck.error) throw baselineCheck.error

process.exit(baselineCheck.status ?? EXIT_FAILURE)
