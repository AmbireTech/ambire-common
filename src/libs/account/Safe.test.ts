import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'
import { SafeTx } from '../../interfaces/safe'
import { Safe } from './Safe'

const SAFE_ADDR = '0x1111111111111111111111111111111111111111'

const account = {
  addr: SAFE_ADDR,
  associatedKeys: [],
  initialPrivileges: [],
  creation: null,
  safeCreation: {
    factoryAddr: '0x3333333333333333333333333333333333333333',
    singleton: '0x4444444444444444444444444444444444444444',
    saltNonce: '0x01',
    setupData: '0x'
  },
  preferences: { label: 'Safe', pfp: SAFE_ADDR }
} as Account

const ethereum = { chainId: 1n, nativeAssetSymbol: 'ETH' } as Network
const optimism = { chainId: 10n, nativeAssetSymbol: 'ETH' } as Network

const makeAccountState = (safeVersion: string | null) =>
  ({ isDeployed: true, nonce: 0n, threshold: 1, safeVersion }) as AccountOnchainState

const safeTx: SafeTx = {
  to: ZeroAddress as Hex,
  value: '0x00',
  data: '0x',
  operation: 0,
  safeTxGas: '0x00',
  baseGas: '0x00',
  gasPrice: '0x00',
  gasToken: ZeroAddress as Hex,
  refundReceiver: ZeroAddress as Hex,
  nonce: '0x00'
}

describe('Safe getTxnTypedData', () => {
  test('uses the chain bound typed data for Safe v1.3+', () => {
    const typedData = new Safe(account, ethereum, makeAccountState('1.4.1'), true).getTxnTypedData(
      safeTx
    )

    expect(typedData.domain).toEqual({ chainId: '1', verifyingContract: SAFE_ADDR })
  })

  test('uses the legacy typed data without a chain id for Safe v1.1 and v1.2', () => {
    const v11TypedData = new Safe(
      account,
      ethereum,
      makeAccountState('1.1.1'),
      true
    ).getTxnTypedData(safeTx)
    const v12TypedData = new Safe(
      account,
      ethereum,
      makeAccountState('1.2.0'),
      true
    ).getTxnTypedData(safeTx)

    expect(v11TypedData.domain).toEqual({ verifyingContract: SAFE_ADDR })
    expect(v12TypedData.domain).toEqual({ verifyingContract: SAFE_ADDR })
  })

  test('picks the typed data from the Safe version of each chain', () => {
    const ethereumTypedData = new Safe(
      account,
      ethereum,
      makeAccountState('1.1.1'),
      true
    ).getTxnTypedData(safeTx)
    const optimismTypedData = new Safe(
      account,
      optimism,
      makeAccountState('1.4.1'),
      true
    ).getTxnTypedData(safeTx)

    expect(ethereumTypedData.domain).toEqual({ verifyingContract: SAFE_ADDR })
    expect(optimismTypedData.domain).toEqual({ chainId: '10', verifyingContract: SAFE_ADDR })
  })

  test('falls back to the chain bound typed data when the Safe version is unknown', () => {
    const typedData = new Safe(account, ethereum, makeAccountState(null), true).getTxnTypedData(
      safeTx
    )

    expect(typedData.domain).toEqual({ chainId: '1', verifyingContract: SAFE_ADDR })
  })
})
