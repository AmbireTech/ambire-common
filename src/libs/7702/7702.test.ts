import { describe, expect, test } from '@jest/globals'

import { EIP7702Auth } from '../../consts/7702'
import { EIP_7702_AMBIRE_ACCOUNT, EIP_7702_GRID_PLUS, EIP_7702_METAMASK } from '../../consts/deploy'
import { Hex } from '../../interfaces/hex'
import { getUserOpDelegator } from './7702'

const chainId = 137n
const internalKeys = [{ type: 'internal' as const }]
const latticeKeys = [{ type: 'lattice' as const }]

const getAuth = (address: Hex): EIP7702Auth => ({
  address,
  chainId: '0x89',
  nonce: '0x01',
  r: '0x01',
  s: '0x01',
  v: '0x1b',
  yParity: '0x00'
})

describe('getUserOpDelegator', () => {
  test('picks the authorized contract over a foreign delegation the authorization replaces', () => {
    // An EOA delegated to MetaMask that re-delegates to Ambire in the same userOp gets
    // validated by Ambire. Picking MetaMask signs in the wrong format and fails with AA24
    expect(
      getUserOpDelegator({
        eip7702Auth: getAuth(EIP_7702_AMBIRE_ACCOUNT),
        delegatedContract: EIP_7702_METAMASK,
        chainId,
        accountKeys: internalKeys
      })
    ).toBe(EIP_7702_AMBIRE_ACCOUNT)
  })

  test('picks the authorized GridPlus contract over a foreign delegation for Lattice keys', () => {
    expect(
      getUserOpDelegator({
        eip7702Auth: getAuth(EIP_7702_GRID_PLUS),
        delegatedContract: EIP_7702_METAMASK,
        chainId,
        accountKeys: latticeKeys
      })
    ).toBe(EIP_7702_GRID_PLUS)
  })

  test('picks the authorized contract for an EOA that is not delegated yet', () => {
    expect(
      getUserOpDelegator({
        eip7702Auth: getAuth(EIP_7702_AMBIRE_ACCOUNT),
        delegatedContract: null,
        chainId,
        accountKeys: internalKeys
      })
    ).toBe(EIP_7702_AMBIRE_ACCOUNT)
  })

  test('picks the current delegation when the userOp has no authorization', () => {
    expect(
      getUserOpDelegator({
        delegatedContract: EIP_7702_GRID_PLUS,
        chainId,
        accountKeys: internalKeys
      })
    ).toBe(EIP_7702_GRID_PLUS)
  })

  test('falls back to the contract matching the keys when there is no delegation nor authorization', () => {
    expect(
      getUserOpDelegator({ delegatedContract: null, chainId, accountKeys: internalKeys })
    ).toBe(EIP_7702_AMBIRE_ACCOUNT)
    expect(
      getUserOpDelegator({ delegatedContract: null, chainId, accountKeys: latticeKeys })
    ).toBe(EIP_7702_GRID_PLUS)
  })
})
