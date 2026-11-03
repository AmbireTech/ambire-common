import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../broadcast/broadcast'
import { FeePaymentOption, FullEstimationSummary } from '../estimate/interfaces'
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

const network = {
  chainId: 1n,
  nativeAssetSymbol: 'ETH',
  hasRelayer: true
} as Network

const switchedOverAccountState = {
  isDeployed: true,
  isSmarterEoa: false,
  isErc4337Enabled: true,
  nonce: 0n,
  eoaNonce: 0n,
  erc4337Nonce: 0n,
  threshold: 1
} as AccountOnchainState

// deployed, but the entry point is not a signer of the account yet
const notSwitchedOverAccountState = {
  ...switchedOverAccountState,
  isErc4337Enabled: false
} as AccountOnchainState

const notDeployedAccountState = {
  ...switchedOverAccountState,
  isDeployed: false,
  isErc4337Enabled: false
} as AccountOnchainState

const estimation = {} as FullEstimationSummary

const accountOp = {
  accountAddr: account.addr,
  calls: [{}]
} as AccountOp

const ownNativeFeeOption = {
  availableAmount: 10n,
  paidBy: account.addr,
  gasUsed: 21000n,
  addedNative: 0n,
  token: {
    address: ZeroAddress,
    symbol: 'ETH',
    decimals: 18,
    flags: {
      onGasTank: false
    }
  }
} as FeePaymentOption

const ownTokenFeeOption = {
  ...ownNativeFeeOption,
  token: {
    ...ownNativeFeeOption.token,
    address: '0x3333333333333333333333333333333333333333',
    symbol: 'USDC'
  }
} as FeePaymentOption

const ownGasTankFeeOption = {
  ...ownNativeFeeOption,
  token: {
    ...ownNativeFeeOption.token,
    flags: {
      onGasTank: true
    }
  }
} as FeePaymentOption

const otherWalletNativeFeeOption = {
  ...ownNativeFeeOption,
  paidBy: '0x2222222222222222222222222222222222222222'
} as FeePaymentOption

const emptyOtherWalletNativeFeeOption = {
  ...ownNativeFeeOption,
  paidBy: '0x4444444444444444444444444444444444444444',
  availableAmount: 0n
} as FeePaymentOption

const allFeeOptions = [
  ownNativeFeeOption,
  ownTokenFeeOption,
  ownGasTankFeeOption,
  otherWalletNativeFeeOption,
  emptyOtherWalletNativeFeeOption
]

const ownFeeOptions = [ownNativeFeeOption, ownTokenFeeOption, ownGasTankFeeOption]

describe('V1 fee options', () => {
  const v1 = new V1(account, network, switchedOverAccountState, true)

  test('only another wallet with enough funds can pay the fee', () => {
    expect(v1.getAvailableFeeOptions(estimation, allFeeOptions)).toEqual([
      otherWalletNativeFeeOption
    ])
  })

  test('the account itself cannot pay the fee, not even to display errors', () => {
    expect(v1.getAvailableFeeOptions(estimation, ownFeeOptions)).toEqual([])
  })

  test('no fee options when no other wallet has funds', () => {
    expect(
      v1.getAvailableFeeOptions(estimation, [ownNativeFeeOption, emptyOtherWalletNativeFeeOption])
    ).toEqual([])
  })

  test('always broadcasts by another wallet', () => {
    allFeeOptions.forEach((feeOption) => {
      expect(v1.getBroadcastOption(feeOption, { op: accountOp })).toBe(
        BROADCAST_OPTIONS.byOtherEOA
      )
    })
  })
})

describe('V2 fee options', () => {
  describe('not switched over to ERC-4337', () => {
    const v2 = new V2(account, network, notSwitchedOverAccountState, true)

    test('only another wallet with enough funds can pay the fee', () => {
      expect(v2.getAvailableFeeOptions(estimation, allFeeOptions, accountOp)).toEqual([
        otherWalletNativeFeeOption
      ])
    })

    test('the account itself cannot pay the fee, not even in native', () => {
      expect(v2.getAvailableFeeOptions(estimation, ownFeeOptions, accountOp)).toEqual([])
    })

    test('the same applies when ERC-4337 is turned off', () => {
      const v2WithoutErc4337 = new V2(account, network, notSwitchedOverAccountState, false)

      expect(v2WithoutErc4337.getAvailableFeeOptions(estimation, allFeeOptions, accountOp)).toEqual(
        [otherWalletNativeFeeOption]
      )
    })

    test('broadcasts by another wallet', () => {
      expect(v2.getBroadcastOption(otherWalletNativeFeeOption, { op: accountOp })).toBe(
        BROADCAST_OPTIONS.byOtherEOA
      )
    })

    test('the switch over call is added when another wallet pays', () => {
      expect(v2.shouldIncludeActivatorCall(otherWalletNativeFeeOption.paidBy)).toBe(true)
    })
  })

  describe('switched over to ERC-4337', () => {
    const v2 = new V2(account, network, switchedOverAccountState, true)

    test('the account itself can still pay the fee', () => {
      expect(v2.getAvailableFeeOptions(estimation, allFeeOptions, accountOp)).toEqual(
        expect.arrayContaining([ownNativeFeeOption, otherWalletNativeFeeOption])
      )
    })

    test('the account itself broadcasts the ERC-4337 way', () => {
      expect(v2.getBroadcastOption(ownNativeFeeOption, { op: accountOp })).toBe(
        BROADCAST_OPTIONS.byBundler
      )
    })

    test('another wallet broadcasts by itself', () => {
      expect(v2.getBroadcastOption(otherWalletNativeFeeOption, { op: accountOp })).toBe(
        BROADCAST_OPTIONS.byOtherEOA
      )
    })
  })

  describe('not deployed', () => {
    const v2 = new V2(account, network, notDeployedAccountState, true)

    test('the account itself can pay the fee as it deploys the ERC-4337 way', () => {
      expect(v2.getAvailableFeeOptions(estimation, allFeeOptions, accountOp)).toEqual(
        expect.arrayContaining([ownNativeFeeOption])
      )
      expect(v2.getBroadcastOption(ownNativeFeeOption, { op: accountOp })).toBe(
        BROADCAST_OPTIONS.byBundler
      )
    })
  })
})
