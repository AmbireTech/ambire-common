import { describe, expect, jest, test } from '@jest/globals'
import { Transaction } from 'ethers'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp } from '../accountOp/accountOp'
import { BROADCAST_OPTIONS, buildRawTransaction, getUnsignedTransaction } from './broadcast'

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

  test('serializes an unsigned raw transaction (RLP preimage) for a view-only EOA account', async () => {
    const eoaAccount = {
      ...account,
      safeCreation: undefined,
      addr: '0x4b7e9e6c9f6b4a13f1c2d3e4f5a6b7c8d9e0f1a2'
    } as Account
    const eoaOp: AccountOp = {
      ...getAccountOp(100000n),
      accountAddr: eoaAccount.addr,
      nonce: 3n,
      eoaNonce: 3n,
      gasFeePayment: {
        isGasTank: false,
        paidBy: eoaAccount.addr,
        paidByKeyType: 'internal',
        inToken: '0x0000000000000000000000000000000000000000',
        amount: 0n,
        simulatedGasLimit: 100000n,
        gasPrice: 100n,
        maxPriorityFeePerGas: 5n,
        broadcastOption: BROADCAST_OPTIONS.bySelf
      }
    }

    const unsignedRaw = await getUnsignedTransaction(
      eoaAccount,
      eoaOp,
      accountState,
      getProvider('0x186a0'),
      network
    )

    expect(unsignedRaw).toMatch(/^0x/)

    const tx = Transaction.from(unsignedRaw)
    // unsigned transaction has no signature
    expect(tx.signature).toBeNull()
    expect(tx.chainId).toBe(BigInt(network.chainId))
    expect(tx.nonce).toBe(3)
    expect(tx.to).toBe(eoaOp.calls[0]?.to)
    expect(tx.value).toBe(1n)
    expect(tx.gasLimit).toBe(100000n)
    expect(tx.maxPriorityFeePerGas).toBe(5n)
    expect(tx.maxFeePerGas).toBe(100n)
  })

  test('uses the accountOp eoaNonce when available for the unsigned transaction', async () => {
    const eoaAddr = '0x4b7e9e6c9f6b4a13f1e9d3e4f5a6b7c8d9e0f1a2'
    const eoaAccount = {
      addr: eoaAddr,
      associatedKeys: [eoaAddr],
      initialPrivileges: [],
      creation: null,
      preferences: { label: '', pfp: eoaAddr }
    } as Account
    const provider = getProvider('0x186a0')
    const eoaOp: AccountOp = {
      ...getAccountOp(10000n),
      accountAddr: eoaAddr,
      nonce: 9n,
      eoaNonce: 9n,
      gasFeePayment: {
        isGasTank: false,
        paidBy: eoaAddr,
        paidByKeyType: 'internal',
        inToken: '0x0000000000000000000000000000000000000000',
        amount: 0n,
        simulatedGasLimit: 10000n,
        gasPrice: 10n,
        broadcastOption: BROADCAST_OPTIONS.bySelf
      }
    }

    const unsignedRaw = await getUnsignedTransaction(
      eoaAccount,
      eoaOp,
      accountState,
      provider,
      network
    )

    expect(provider.getTransactionCount).not.toHaveBeenCalled()
    expect(Transaction.from(unsignedRaw).nonce).toBe(9)
  })
})
