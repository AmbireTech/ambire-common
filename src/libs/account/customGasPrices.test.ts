import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { FeePaymentOption } from '../estimate/interfaces'
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

const network = {
  chainId: 1n,
  nativeAssetSymbol: 'ETH'
} as Network

const accountState = {
  isDeployed: true,
  isSmarterEoa: false,
  isErc4337Enabled: true,
  nonce: 0n,
  eoaNonce: 0n,
  erc4337Nonce: 0n,
  threshold: 1
} as AccountOnchainState

const nativeFeeOption = {
  availableAmount: 1n,
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

const eoaNativeFeeOption = {
  ...nativeFeeOption,
  paidBy: '0x2222222222222222222222222222222222222222'
} as FeePaymentOption

const tokenFeeOption = {
  ...nativeFeeOption,
  token: {
    ...nativeFeeOption.token,
    address: '0x3333333333333333333333333333333333333333',
    symbol: 'USDC'
  }
} as FeePaymentOption

const accountOp = {
  calls: [{}]
} as AccountOp

const batchAccountOp = {
  calls: [{}, {}]
} as AccountOp

describe('custom gas price support', () => {
  test('EOA, V1 and Safe always allow custom gas prices', () => {
    expect(new EOA(account, network, accountState).canSetCustomGasPrices()).toBe(true)
    expect(new V1(account, network, accountState).canSetCustomGasPrices()).toBe(true)
    expect(new Safe(account, network, accountState).canSetCustomGasPrices()).toBe(true)
  })

  test('EOA7702 allows custom gas prices only for native fee options', () => {
    const eoa7702 = new EOA7702(account, network, accountState)

    expect(eoa7702.canSetCustomGasPrices(nativeFeeOption)).toBe(true)
    expect(eoa7702.canSetCustomGasPrices(tokenFeeOption)).toBe(false)
  })

  test('V2 allows custom gas prices only for native EOA-paid fee options', () => {
    const v2 = new V2(account, network, accountState)

    expect(v2.canSetCustomGasPrices(nativeFeeOption)).toBe(false)
    expect(v2.canSetCustomGasPrices(eoaNativeFeeOption)).toBe(true)
    expect(v2.canSetCustomGasPrices(tokenFeeOption)).toBe(false)
  })

  test('EOA allows custom gas only for single-call account ops', () => {
    const eoa = new EOA(account, network, accountState)

    expect(eoa.canSetCustomGas(nativeFeeOption, accountOp)).toBe(true)
    expect(eoa.canSetCustomGas(nativeFeeOption, batchAccountOp)).toBe(false)
  })

  test('non-EOA custom gas support follows custom gas price support', () => {
    expect(new V1(account, network, accountState).canSetCustomGas(nativeFeeOption)).toBe(true)
    expect(new Safe(account, network, accountState).canSetCustomGas(nativeFeeOption)).toBe(true)
    expect(new EOA7702(account, network, accountState).canSetCustomGas(tokenFeeOption)).toBe(false)
    expect(new V2(account, network, accountState).canSetCustomGas(eoaNativeFeeOption)).toBe(true)
  })
})
