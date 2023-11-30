/* eslint-disable global-require */
import Ajv from 'ajv'

const ajv = new Ajv()

export const schemas: any = {
  EmailVaultData: ajv.compile(require('./schemas/EmailVaultData.json')),
  RecoveryKey: ajv.compile(require('./schemas/RecoveryKey.json')),
  EmailVaultSecrets: ajv.compile(require('./schemas/EmailVaultSecrets.json')),
  RelayerResponseLinkedAccount: ajv.compile(require('./schemas/RelayerResponseLinkedAccount.json')),
  RelayerReponsePortfolioAdditional: ajv.compile(
    require('./schemas/RelayerReponsePortfolioAdditional.json')
  ),
  RelayerResponsePaymasterSign: ajv.compile(require('./schemas/RelayerResponsePaymasterSign.json'))
}
