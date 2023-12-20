/* eslint-disable global-require */
import tv4 from 'tv4'

export const schemas: any = {
  EmailVaultData: (data: any) => ({
    isValid: tv4.validate(require('./schemas/EmailVaultData.json'), data),
    error: tv4.error
  }),
  RecoveryKey: (data: any) => ({
    isValid: tv4.validate(data, require('./schemas/RecoveryKey.json')),
    error: tv4.error
  }),
  EmailVaultSecrets: (data: any) => ({
    isValid: tv4.validate(data, require('./schemas/EmailVaultSecrets.json')),
    error: tv4.error
  }),
  RelayerResponseLinkedAccount: (data: any) => ({
    isValid: tv4.validate(data, require('./schemas/RelayerResponseLinkedAccount.json')),
    error: tv4.error
  }),
  RelayerReponsePortfolioAdditional: (data: any) => ({
    isValid: tv4.validate(data, require('./schemas/RelayerReponsePortfolioAdditional.json')),
    error: tv4.error
  }),
  RelayerResponsePaymasterSign: (data: any) => ({
    isValid: tv4.validate(data, require('./schemas/RelayerResponsePaymasterSign.json')),
    error: tv4.error
  })
}
