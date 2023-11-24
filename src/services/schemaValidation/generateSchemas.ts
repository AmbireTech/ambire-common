import { resolve } from 'path'
import * as TJS from 'typescript-json-schema'
import * as fs from 'fs/promises' // Import fs.promises

// optionally pass argument to schema generator
const SETTINGS: TJS.PartialArgs = {
  required: true
}

// optionally pass ts compiler options
const COMPILER_OPTIONS: TJS.CompilerOptions = {
  strictNullChecks: true
}

const source = TJS.getProgramFromFiles(
  [resolve('src', 'interfaces', 'emailVault.ts')],
  COMPILER_OPTIONS,
  __dirname
)

const generator = TJS.buildGenerator(source, SETTINGS)!
// const emailVaultInterfaces = ['EmailVaultSecrets']
const emailVaultInterfaces = ['EmailVaultSecrets', 'RecoveryKey', 'EmailVaultData']

const allInterfaces = [...emailVaultInterfaces]

allInterfaces.forEach((interfaceName) =>
  fs.writeFile(
    resolve(__dirname, 'schemas', `${interfaceName}.json`),
    JSON.stringify(generator.getSchemaForSymbol(interfaceName), null, 4),
    'utf-8'
  )
)
