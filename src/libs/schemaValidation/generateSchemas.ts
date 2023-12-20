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
  [
    resolve('src', 'interfaces', 'emailVault.ts'),
    resolve('src', 'interfaces', 'account.ts'),
    resolve('src', 'interfaces', 'portfolio.ts'),
    resolve('src', 'interfaces', 'accountOp.ts')
  ],
  COMPILER_OPTIONS,
  __dirname
)

const generator = TJS.buildGenerator(source, SETTINGS)
// console.log(generator)
// const emailVaultInterfaces = ['EmailVaultSecrets']
const allInterfaces = [
  'EmailVaultSecrets',
  'RecoveryKey',
  'EmailVaultData',
  'RelayerResponseLinkedAccount',
  'RelayerReponsePortfolioAdditional',
  'RelayerResponsePaymasterSign'
]

allInterfaces.forEach((interfaceName) => {
  fs.writeFile(
    resolve(__dirname, 'schemas', `${interfaceName}.json`),
    JSON.stringify(generator?.getSchemaForSymbol(interfaceName), null, 4),
    'utf-8'
  )
})
