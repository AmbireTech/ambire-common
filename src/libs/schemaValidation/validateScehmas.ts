/* eslint-disable global-require */
import tv4 from 'tv4'

export const schemas: any = {
  EmailVaultData: tv4.compile(require('./schemas/EmailVaultData.json')),
  RecoveryKey: tv4.compile(require('./schemas/RecoveryKey.json')),
  EmailVaultSecrets: tv4.compile(require('./schemas/EmailVaultSecrets.json')),
  RelayerResponseLinkedAccount: tv4.compile(require('./schemas/RelayerResponseLinkedAccount.json')),
  RelayerReponsePortfolioAdditional: tv4.compile(
    require('./schemas/RelayerReponsePortfolioAdditional.json')
  ),
  RelayerResponsePaymasterSign: tv4.compile(require('./schemas/RelayerResponsePaymasterSign.json'))
}
