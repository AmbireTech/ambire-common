import { expect } from '@jest/globals'
import { schemas } from './validateScehmas'

const data = {
  EmailVaultData: {
    correct: [
      {
        recoveryKey: 'string',
        email: 'string',
        availableAccounts: {
          addr1: {
            addr: 'AccountId',
            associatedKeys: {
              ethereum: {
                key1: 'string'
              }
            },
            creation: {
              factoryAddr: 'string',
              bytecode: 'string',
              salt: 'string'
            }
          }
        },
        availableSecrets: {
          key1: {
            key: 'string',
            value: 'string',
            type: 'recoveryKey'
          }
        },
        criticalError: new Error('asd'),
        errors: [new Error('asd')]
      }
    ]
  },
  RelayerResponsePaymasterSign: {
    correct: [
      {
        success: true,
        data: { paymasterAndData: 'string' },
        errorState: []
      }
    ]
  }
}

describe('Describe', () => {
  test('EmailVaultData', () => {
    const res = schemas.EmailVaultData(data.EmailVaultData.correct[0])
    expect(res.isValid).toBeTruthy()
    expect(res.error).toBeNull()
  })
  test('RelayerResponsePaymasterSign', () => {
    const res = schemas.RelayerResponsePaymasterSign(data.RelayerResponsePaymasterSign.correct[0])
    expect(res.isValid).toBeTruthy()
    expect(res.error).toBeNull()
  })
})
