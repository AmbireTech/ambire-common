import { describe, expect, test } from '@jest/globals'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { BaseAccount } from './BaseAccount'
import { EOA } from './EOA'
import { EOA7702 } from './EOA7702'
import { Safe } from './Safe'
import { V1 } from './V1'
import { V2 } from './V2'

const account = {
  addr: '0x1111111111111111111111111111111111111111',
  associatedKeys: [],
  initialPrivileges: [],
  creation: null,
  preferences: {
    label: 'Account',
    pfp: '0x1111111111111111111111111111111111111111'
  }
} as Account

const ethereum = { chainId: 1n, nativeAssetSymbol: 'ETH' } as Network
const polygon = { chainId: 137n, nativeAssetSymbol: 'POL' } as Network
const sepolia = { chainId: 11155111n, nativeAssetSymbol: 'ETH' } as Network

const accountState = {
  isDeployed: true,
  isSmarterEoa: false,
  isErc4337Enabled: true,
  nonce: 0n,
  eoaNonce: 0n,
  erc4337Nonce: 0n,
  threshold: 1
} as AccountOnchainState

type AccountClass = new (
  account: Account,
  network: Network,
  accountState: AccountOnchainState,
  isErc4337Enabled: boolean
) => BaseAccount

const create = (AccountType: AccountClass, network: Network) =>
  new AccountType(account, network, accountState, true)

describe('BaseAccount.getGasPriceFetchStrategy', () => {
  describe.each([
    ['EOA', EOA],
    ['V1', V1]
  ] as [string, AccountClass][])('%s (cannot use ERC-4337)', (_name, AccountType) => {
    test('uses the RPC only on Ethereum', () => {
      expect(create(AccountType, ethereum).getGasPriceFetchStrategy(true)).toBe('rpc')
    })

    test('prefers the bundler on other networks', () => {
      expect(create(AccountType, polygon).getGasPriceFetchStrategy(true)).toBe(
        'bundlerWithRpcFallback'
      )
    })
  })

  describe.each([
    ['EOA7702', EOA7702],
    ['V2', V2],
    ['Safe', Safe]
  ] as [string, AccountClass][])('%s (can use ERC-4337)', (_name, AccountType) => {
    test('uses the RPC with a bundler fallback on Ethereum', () => {
      expect(create(AccountType, ethereum).getGasPriceFetchStrategy(true)).toBe(
        'rpcWithBundlerFallback'
      )
    })

    test('prefers the bundler on other networks', () => {
      expect(create(AccountType, polygon).getGasPriceFetchStrategy(true)).toBe(
        'bundlerWithRpcFallback'
      )
    })

    test('treats Ethereum testnets as other networks', () => {
      expect(create(AccountType, sepolia).getGasPriceFetchStrategy(true)).toBe(
        'bundlerWithRpcFallback'
      )
    })
  })

  describe.each([
    ['EOA', EOA],
    ['EOA7702', EOA7702],
    ['V1', V1],
    ['V2', V2],
    ['Safe', Safe]
  ] as [string, AccountClass][])('%s with ERC-4337 disabled', (_name, AccountType) => {
    test.each([
      ['Ethereum', ethereum],
      ['other networks', polygon]
    ])('uses the RPC only on %s', (_networkName, network) => {
      expect(create(AccountType, network).getGasPriceFetchStrategy(false)).toBe('rpc')
    })
  })
})

describe('BaseAccount.shouldUseRpcGasPrices', () => {
  const safe = create(Safe, ethereum)

  test('uses the bundler gas prices for a bundler broadcast', () => {
    expect(safe.shouldUseRpcGasPrices(BROADCAST_OPTIONS.byBundler)).toBe(false)
  })

  test.each([
    BROADCAST_OPTIONS.bySelf,
    BROADCAST_OPTIONS.bySelf7702,
    BROADCAST_OPTIONS.byOtherEOA,
    BROADCAST_OPTIONS.byRelayer,
    BROADCAST_OPTIONS.delegation
  ])('uses the RPC gas prices for a "%s" broadcast', (broadcastOption) => {
    expect(safe.shouldUseRpcGasPrices(broadcastOption)).toBe(true)
  })
})
