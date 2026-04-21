import { concat, getAddress, getBytes, Interface, solidityPacked } from 'ethers'

import { DEPLOYLESS_SIMULATION_FROM } from '@/consts/deploy'
import { networks } from '@/consts/networks'
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import SafeContract from '../../../contracts/compiled/Safe.json'
import { multiSendAddr, safeSimulateTxAccessor } from '../../consts/safe'
import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { BaseAccount } from '../account/BaseAccount'
import { AccountOp } from '../accountOp/accountOp'
import {
  getSafeAccessListCallParams,
  getShouldUseAccessListCall,
  getSimulateTxnAccessor,
  parseAccessList,
  sendCreateAccessList
} from './accessListCall'

const safeIface = new Interface(SafeContract)
const simulateAccessorIface = new Interface([
  'function simulate(address to, uint256 value, bytes data, uint8 operation)'
])
const multiSendIface = new Interface(['function multiSend(bytes transactions)'])

const SAFE_CALL_OPERATION = 0n
const SAFE_DELEGATE_CALL_OPERATION = 1n
const ACCOUNT_ADDRESS = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'

function makeNetwork(overrides: Partial<Network> = {}): Network {
  const ethereum = networks.find((n) => n.chainId === 1n)!
  return {
    ...ethereum,
    ...overrides
  }
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    addr: ACCOUNT_ADDRESS,
    associatedKeys: ['0x2222222222222222222222222222222222222222'],
    initialPrivileges: [],
    creation: null,
    preferences: { label: 'Test', pfp: ACCOUNT_ADDRESS },
    ...overrides
  }
}

function makeSafeAccount(version = '1.4.1', overrides: Partial<Account> = {}): Account {
  return makeAccount({
    safeCreation: {
      factoryAddr: '0x3333333333333333333333333333333333333333',
      singleton: '0x4444444444444444444444444444444444444444',
      saltNonce: '0x01',
      setupData: '0x',
      version
    },
    ...overrides
  })
}

function makeAccountState(overrides: Partial<AccountOnchainState> = {}): AccountOnchainState {
  return {
    accountAddr: ACCOUNT_ADDRESS,
    isDeployed: true,
    eoaNonce: 0n,
    nonce: 1n,
    erc4337Nonce: 0n,
    associatedKeys: ['0x2222222222222222222222222222222222222222'],
    importedAccountKeys: [],
    balance: 0n,
    isEOA: true,
    isErc4337Enabled: false,
    isErc4337Nonce: false,
    isV2: true,
    currentBlock: 1n,
    isSmarterEoa: false,
    delegatedContract: null,
    delegatedContractName: null,
    threshold: 1,
    updatedAt: Date.now(),
    ...overrides
  }
}

function makeAccountOp(overrides: Partial<AccountOp> = {}): AccountOp {
  return {
    id: 'op-1',
    accountAddr: ACCOUNT_ADDRESS,
    chainId: 1n,
    signingKeyAddr: '0x2222222222222222222222222222222222222222',
    signingKeyType: 'internal',
    nonce: 1n,
    calls: [
      {
        to: '0x5555555555555555555555555555555555555555',
        value: 1n,
        data: '0x12'
      }
    ],
    gasLimit: null,
    signature: null,
    gasFeePayment: null,
    ...overrides
  }
}

function makeBaseAccount(account: Account): BaseAccount {
  return {
    getAccount: () => account
  } as unknown as BaseAccount
}

describe('accessListCall helpers', () => {
  afterEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
  })

  describe('getSimulateTxnAccessor', () => {
    it('returns Safe accessor for supported Safe versions', () => {
      expect(getSimulateTxnAccessor('1.3.0')).toBe(safeSimulateTxAccessor['v1.3.0'])
      expect(getSimulateTxnAccessor('1.4.1')).toBe(safeSimulateTxAccessor['v1.4.1'])
      expect(getSimulateTxnAccessor('1.5.0')).toBe(safeSimulateTxAccessor['v1.5.0'])
    })

    it('returns null for unsupported and empty versions', () => {
      expect(getSimulateTxnAccessor()).toBeNull()
      expect(getSimulateTxnAccessor('')).toBeNull()
      expect(getSimulateTxnAccessor('1.6.0')).toBeNull()
      expect(getSimulateTxnAccessor('2.0.0')).toBeNull()
    })
  })

  describe('getShouldUseAccessListCall', () => {
    it('returns true for Safe with supported version', () => {
      const account = makeSafeAccount('1.4.1')
      expect(getShouldUseAccessListCall(account, false)).toBe(true)
    })

    it('returns false for Safe with unsupported version', () => {
      const account = makeSafeAccount('1.6.0')
      expect(getShouldUseAccessListCall(account, false)).toBe(false)
    })

    it('returns true for non-safe without state override need', () => {
      const account = makeAccount()
      expect(getShouldUseAccessListCall(account, false)).toBe(true)
    })

    it('returns false for non-safe with state override need', () => {
      const account = makeAccount()
      expect(getShouldUseAccessListCall(account, true)).toBe(false)
    })
  })

  describe('parseAccessList', () => {
    it('returns empty array for undefined or empty access list', () => {
      expect(parseAccessList(undefined)).toEqual([])
      expect(parseAccessList([])).toEqual([])
    })

    it('normalizes and deduplicates addresses', () => {
      const lower = '0x982f2df63fe38ab8d55f4b1464e8cfdc8ea5dec8'
      const checksum = getAddress(lower)

      const parsed = parseAccessList([
        { address: lower, storageKeys: [] },
        { address: checksum, storageKeys: ['0x01'] }
      ])

      expect(parsed).toEqual([checksum])
    })

    it('ignores malformed addresses and keeps valid ones', () => {
      const valid = '0x982f2df63fe38ab8d55f4b1464e8cfdc8ea5dec8'
      const parsed = parseAccessList([
        { address: valid, storageKeys: [] },
        { address: 'not-an-address', storageKeys: [] }
      ])

      expect(parsed).toEqual([getAddress(valid)])
    })

    it('returns empty array when all addresses are malformed', () => {
      const parsed = parseAccessList([
        { address: 'invalid-1', storageKeys: [] },
        { address: 'invalid-2', storageKeys: [] }
      ])

      expect(parsed).toEqual([])
    })
  })

  describe('getSafeAccessListCallParams', () => {
    it('builds direct simulate payload for single call', () => {
      const account = makeSafeAccount('1.4.1')
      const op = makeAccountOp({
        calls: [{ to: '0x5555555555555555555555555555555555555555', value: 7n, data: '0x1234' }]
      })
      const baseAcc = makeBaseAccount(account)
      const state = makeAccountState({ isDeployed: true })

      const params = getSafeAccessListCallParams(baseAcc, op, state)
      expect(params).toBeTruthy()
      expect(params).toMatchObject({ to: account.addr, from: DEPLOYLESS_SIMULATION_FROM, value: 0 })

      const decodedOuter = safeIface.decodeFunctionData('simulateAndRevert', params!.data)
      expect(decodedOuter[0]).toBe(safeSimulateTxAccessor['v1.4.1'])

      const decodedSimulate = simulateAccessorIface.decodeFunctionData('simulate', decodedOuter[1])
      expect(decodedSimulate[0]).toBe(op.calls[0]!.to)
      expect(decodedSimulate[1]).toBe(7n)
      expect(decodedSimulate[2]).toBe('0x1234')
      expect(decodedSimulate[3]).toBe(SAFE_CALL_OPERATION)
    })

    it('builds multisend simulate payload for batched calls', () => {
      const account = makeSafeAccount('1.5.0')
      const op = makeAccountOp({
        calls: [
          { to: '0x5555555555555555555555555555555555555555', value: 1n, data: '0x12' },
          { to: '0x6666666666666666666666666666666666666666', value: 2n, data: '0x1234' }
        ]
      })
      const baseAcc = makeBaseAccount(account)
      const state = makeAccountState({ isDeployed: true })

      const params = getSafeAccessListCallParams(baseAcc, op, state)
      expect(params).toBeTruthy()

      const decodedOuter = safeIface.decodeFunctionData('simulateAndRevert', params!.data)
      const decodedSimulate = simulateAccessorIface.decodeFunctionData('simulate', decodedOuter[1])
      expect(decodedSimulate[0]).toBe(multiSendAddr)
      expect(decodedSimulate[1]).toBe(0n)
      expect(decodedSimulate[3]).toBe(SAFE_DELEGATE_CALL_OPERATION)

      const decodedMultisend = multiSendIface.decodeFunctionData('multiSend', decodedSimulate[2])
      const expectedMultisendPayload = concat(
        op.calls.map((call) =>
          solidityPacked(
            ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
            [
              SAFE_CALL_OPERATION,
              call.to,
              call.value,
              BigInt(getBytes(call.data).length),
              call.data
            ]
          )
        )
      )

      expect(decodedMultisend[0]).toBe(expectedMultisendPayload)
    })

    it('returns null for non-safe or non-deployed Safe', () => {
      const nonSafeParams = getSafeAccessListCallParams(
        makeBaseAccount(makeAccount()),
        makeAccountOp(),
        makeAccountState({ isDeployed: true })
      )
      const undeployedSafeParams = getSafeAccessListCallParams(
        makeBaseAccount(makeSafeAccount('1.4.1')),
        makeAccountOp(),
        makeAccountState({ isDeployed: false })
      )

      expect(nonSafeParams).toBeNull()
      expect(undeployedSafeParams).toBeNull()
    })

    it('Should not throw for unsupported Safe versions and should return null', () => {
      const account = makeSafeAccount('1.6.0')
      const baseAcc = makeBaseAccount(account)
      const state = makeAccountState({ isDeployed: true })
      const op = makeAccountOp()

      expect(() => getSafeAccessListCallParams(baseAcc, op, state)).not.toThrow()
      expect(getSafeAccessListCallParams(baseAcc, op, state)).toBeNull()
    })
  })

  describe('sendCreateAccessList', () => {
    const params = {
      to: '0x5555555555555555555555555555555555555555',
      value: '15',
      data: '0x1234',
      from: ACCOUNT_ADDRESS
    }

    let network: Network
    let provider: { send: ReturnType<typeof jest.fn> }

    beforeEach(() => {
      network = makeNetwork()
      provider = {
        send: jest.fn().mockResolvedValue({ accessList: [], gasUsed: '0x1' } as never)
      }
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    it('sends two-parameter eth_createAccessList request by default', async () => {
      await sendCreateAccessList(provider as any, params, network)

      expect(provider.send).toHaveBeenCalledTimes(1)
      expect(provider.send).toHaveBeenCalledWith('eth_createAccessList', [
        {
          to: params.to,
          value: '0xf',
          data: params.data,
          from: params.from
        },
        'latest'
      ])
    })

    it('tries stateOverride and falls back to two-parameter request', async () => {
      provider.send
        .mockRejectedValueOnce(new Error('override not supported'))
        .mockResolvedValueOnce({ accessList: [], gasUsed: '0x1' })

      const stateOverride = {
        ACCOUNT_ADDRESS: {
          code: '0x1234'
        }
      }

      await sendCreateAccessList(provider as any, params, network, stateOverride)

      expect(provider.send).toHaveBeenCalledTimes(2)
      const firstCallParams = provider.send.mock.calls[0]![1]
      expect(firstCallParams).toHaveLength(3)
      expect(firstCallParams[2][params.from].balance).toBe(
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      )

      const secondCallParams = provider.send.mock.calls[1]![1]
      expect(secondCallParams).toHaveLength(2)
    })

    it('skips stateOverride usage when rpcNoStateOverride is true', async () => {
      const noOverrideNetwork = makeNetwork({ rpcNoStateOverride: true })

      await sendCreateAccessList(provider as any, params, noOverrideNetwork, {
        [params.from]: { code: '0x1234' }
      })

      expect(provider.send).toHaveBeenCalledTimes(1)
      const args = provider.send.mock.calls[0]![1]
      expect(args).toHaveLength(2)
    })

    it('propagates error when two-parameter request fails', async () => {
      const error = new Error('rpc down')
      provider.send.mockRejectedValue(error)

      await expect(sendCreateAccessList(provider as any, params, network)).rejects.toThrow(
        'rpc down'
      )
    })
  })
})
