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
  }
}

describe('Describe', () => {
  test('EmailVaultData', () => {
    const res = schemas.EmailVaultData(data.EmailVaultData.correct[0])
    expect(res).toBeTruthy()
    expect(schemas.EmailVaultData.errors).toBeNull()
  })
})
