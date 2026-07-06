import { describe, expect, jest, test } from '@jest/globals'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS, buildRawTransaction } from './broadcast'

const safeAddr = '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce'
const signerAddr = '0xe699999999999999999999999999999999996133'

const account = {
  addr: safeAddr,
  associatedKeys: [signerAddr],
  initialPrivileges: [],
  creation: null,
  safeCreation: {
    factoryAddr: '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67',
    singleton: '0x29fcb43b46531bca003ddc8fcb67ffe91900c762',
    saltNonce: '0x00',
    setupData: '0x',
    version: '1.4.1'
  },
  preferences: {
    label: 'Safe',
    pfp: safeAddr
  }
} as Account

const accountState = {
  isDeployed: true,
  nonce: 0n
} as AccountOnchainState

const network = {
  chainId: 6342n,
  feeOptions: { is1559: true }
} as Network

function getAccountOp(simulatedGasLimit: bigint, isCustomGasLimit = false): AccountOp {
  return {
    id: 'safe-op',
    accountAddr: safeAddr,
    chainId: 6342n,
    signingKeyAddr: signerAddr,
    signingKeyType: 'internal',
    nonce: 0n,
    calls: [
      {
        to: signerAddr,
        value: 1n,
        data: '0x'
      }
    ],
    gasLimit: null,
    signature: '0x',
    gasFeePayment: {
      isGasTank: false,
      paidBy: signerAddr,
      paidByKeyType: 'internal',
      inToken: '0x0000000000000000000000000000000000000000',
      amount: 0n,
      simulatedGasLimit,
      isCustomGasLimit,
      gasPrice: 1n,
      maxPriorityFeePerGas: 1n,
      broadcastOption: BROADCAST_OPTIONS.byOtherEOA
    }
  }
}

function getProvider(estimatedGas: string) {
  return {
    send: jest.fn(async () => estimatedGas),
    getTransactionCount: jest.fn(async () => 7)
  } as unknown as RPCProvider
}

describe('broadcast', () => {
  test('uses the final RPC estimate for Safe broadcasts when it is higher than simulated gas', async () => {
    const provider = getProvider('0x186a0')

    const rawTxn = await buildRawTransaction(
      account,
      getAccountOp(50000n),
      accountState,
      provider,
      network,
      7,
      BROADCAST_OPTIONS.byOtherEOA
    )

    expect(rawTxn.gasLimit).toBe(110000n)
    expect(provider.send).toHaveBeenCalledWith(
      'eth_estimateGas',
      expect.arrayContaining([
        expect.objectContaining({
          from: signerAddr,
          to: safeAddr,
          nonce: '0x7'
        })
      ])
    )
  })

  test('keeps the simulated gas for Safe broadcasts when it is higher than the final RPC estimate', async () => {
    const rawTxn = await buildRawTransaction(
      account,
      getAccountOp(150000n),
      accountState,
      getProvider('0x186a0'),
      network,
      7,
      BROADCAST_OPTIONS.byOtherEOA
    )

    expect(rawTxn.gasLimit).toBe(150000n)
  })

  test('keeps custom gas for Safe broadcasts without re-estimating', async () => {
    const provider = getProvider('0x186a0')
    const rawTxn = await buildRawTransaction(
      account,
      getAccountOp(50000n, true),
      accountState,
      provider,
      network,
      7,
      BROADCAST_OPTIONS.byOtherEOA
    )

    expect(rawTxn.gasLimit).toBe(50000n)
    expect(provider.send).not.toHaveBeenCalled()
  })
})
