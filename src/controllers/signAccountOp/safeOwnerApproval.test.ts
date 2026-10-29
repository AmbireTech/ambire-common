import { getAddress, Interface, ZeroAddress } from 'ethers'

import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { Account } from '../../interfaces/account'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOpStatus } from '../../libs/accountOp/types'
import * as safeLib from '../../libs/safe/safe'
import {
  getSafeOwnerApprovalAccountOp,
  getSafeOwnerApprovalFailureMessage,
  getSafeSmartAccountOwners,
  waitForSafeOwnerApproval
} from './safeOwnerApproval'

const SAFE_ADDR = '0x68939cCbcb96433480bD168a09BD164aF9fac8A2'
const AMBIRE_OWNER = '0xae376B42699fDB0D80e9ceE068A4f75ae6d70d85'
const SAFE_OWNER = '0xc88734Bd78407a4bd7d3fc4dd0b30Bc8876bF0B2'
const EOA_OWNER = '0xE691cDAbc7dC1e6C1C0e3d4b0aF0bd0486961330'
const NOT_IMPORTED_OWNER = '0x000000000000000000000000000000000000dEaD'
const SAFE_TXN_HASH = `0x${'ab'.repeat(32)}`
const provider = {} as RPCProvider

const accounts = [
  { addr: AMBIRE_OWNER, creation: { factoryAddr: ZeroAddress } },
  { addr: SAFE_OWNER, creation: null, safeCreation: { factoryAddr: ZeroAddress } },
  { addr: EOA_OWNER, creation: null }
] as unknown as Account[]

/** Fast enough for tests, the defaults wait seconds between checks */
const fastTimings = { checkIntervalMs: 1, checkTimeoutMs: 50, timeoutMs: 200 }

describe('getSafeSmartAccountOwners', () => {
  test('keeps the owners that are imported Ambire or Safe accounts', () => {
    expect(
      getSafeSmartAccountOwners([EOA_OWNER, AMBIRE_OWNER, NOT_IMPORTED_OWNER, SAFE_OWNER], accounts)
    ).toEqual([AMBIRE_OWNER, SAFE_OWNER])
  })

  test('matches owners regardless of address casing and keeps their casing', () => {
    expect(getSafeSmartAccountOwners([AMBIRE_OWNER.toLowerCase()], accounts)).toEqual([
      AMBIRE_OWNER.toLowerCase()
    ])
  })

  test('returns no owners when none of them are imported smart accounts', () => {
    expect(getSafeSmartAccountOwners([EOA_OWNER, NOT_IMPORTED_OWNER], accounts)).toEqual([])
    expect(getSafeSmartAccountOwners([], accounts)).toEqual([])
  })
})

describe('getSafeOwnerApprovalAccountOp', () => {
  test('is a transaction of the owner that approves the Safe transaction hash', () => {
    const accountOp = getSafeOwnerApprovalAccountOp({
      ownerAddr: AMBIRE_OWNER,
      chainId: 10n,
      nonce: 7n,
      safeAddr: SAFE_ADDR,
      safeTxnHash: SAFE_TXN_HASH
    })

    expect(accountOp).toMatchObject({
      accountAddr: AMBIRE_OWNER,
      chainId: 10n,
      nonce: 7n,
      signingKeyAddr: null,
      signingKeyType: null,
      gasFeePayment: null,
      signature: null
    })
    expect(accountOp.calls).toHaveLength(1)
    const [call] = accountOp.calls
    expect(call!.to).toBe(getAddress(SAFE_ADDR))
    expect(call!.value).toBe(0n)
    expect(call!.id).toBeTruthy()
    expect(
      new Interface(['function approveHash(bytes32)']).decodeFunctionData(
        'approveHash',
        call!.data
      )[0]
    ).toBe(SAFE_TXN_HASH)
  })

  test('gets new ids every time', () => {
    const props = {
      ownerAddr: AMBIRE_OWNER,
      chainId: 10n,
      nonce: 7n,
      safeAddr: SAFE_ADDR,
      safeTxnHash: SAFE_TXN_HASH
    }

    expect(getSafeOwnerApprovalAccountOp(props).id).not.toBe(
      getSafeOwnerApprovalAccountOp(props).id
    )
  })
})

describe('waitForSafeOwnerApproval', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const wait = (overrides: Partial<Parameters<typeof waitForSafeOwnerApproval>[0]> = {}) =>
    waitForSafeOwnerApproval({
      safeAddr: SAFE_ADDR,
      ownerAddr: AMBIRE_OWNER,
      safeTxnHash: SAFE_TXN_HASH,
      provider,
      getSentApprovalStatus: () => AccountOpStatus.BroadcastedButNotConfirmed,
      shouldStop: () => false,
      onCheckError: () => {},
      ...fastTimings,
      ...overrides
    })

  test('resolves as approved once the Safe has the approval', async () => {
    const isApprovedSpy = jest
      .spyOn(safeLib, 'isSafeHashApproved')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    await expect(wait()).resolves.toEqual({ isApproved: true, hasFailed: false })
    expect(isApprovedSpy).toHaveBeenCalledTimes(2)
    expect(isApprovedSpy).toHaveBeenCalledWith(SAFE_ADDR, AMBIRE_OWNER, SAFE_TXN_HASH, provider)
  })

  test('stops early when the approval transaction failed or was rejected', async () => {
    const isApprovedSpy = jest.spyOn(safeLib, 'isSafeHashApproved').mockResolvedValue(false)

    await expect(wait({ getSentApprovalStatus: () => AccountOpStatus.Failure })).resolves.toEqual({
      isApproved: false,
      hasFailed: true
    })
    await expect(wait({ getSentApprovalStatus: () => AccountOpStatus.Rejected })).resolves.toEqual({
      isApproved: false,
      hasFailed: true
    })
    expect(isApprovedSpy).toHaveBeenCalledTimes(2)
  })

  test('keeps checking while the approval transaction is unknown or still pending', async () => {
    const isApprovedSpy = jest
      .spyOn(safeLib, 'isSafeHashApproved')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const statuses = [undefined, AccountOpStatus.Pending]

    await expect(wait({ getSentApprovalStatus: () => statuses.shift() })).resolves.toEqual({
      isApproved: true,
      hasFailed: false
    })
    expect(isApprovedSpy).toHaveBeenCalledTimes(3)
  })

  test('gives up when the approval is not onchain in time', async () => {
    jest.spyOn(safeLib, 'isSafeHashApproved').mockResolvedValue(false)

    await expect(wait()).resolves.toEqual({ isApproved: false, hasFailed: false })
  })

  test('stops when asked to, e.g. when the Safe request is closed', async () => {
    const isApprovedSpy = jest.spyOn(safeLib, 'isSafeHashApproved').mockResolvedValue(false)
    let checks = 0

    await expect(wait({ shouldStop: () => checks++ >= 2 })).resolves.toEqual({
      isApproved: false,
      hasFailed: false
    })
    expect(isApprovedSpy).toHaveBeenCalledTimes(2)
  })

  test('reports a failed check and checks again', async () => {
    const rpcError = new Error('RPC down')
    jest
      .spyOn(safeLib, 'isSafeHashApproved')
      .mockRejectedValueOnce(rpcError)
      .mockResolvedValueOnce(true)
    const onCheckError = jest.fn()

    await expect(wait({ onCheckError })).resolves.toEqual({ isApproved: true, hasFailed: false })
    expect(onCheckError).toHaveBeenCalledWith(rpcError)
  })

  test('times out a check that never settles and checks again', async () => {
    jest
      .spyOn(safeLib, 'isSafeHashApproved')
      .mockImplementationOnce(() => new Promise<boolean>(() => {}))
      .mockResolvedValueOnce(true)
    const onCheckError = jest.fn()

    await expect(wait({ onCheckError })).resolves.toEqual({ isApproved: true, hasFailed: false })
    expect(onCheckError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Checking the Safe owner approval timed out after 50ms' })
    )
  })
})

describe('getSafeOwnerApprovalFailureMessage', () => {
  test('tells the user why the approval was not added', () => {
    expect(getSafeOwnerApprovalFailureMessage({ isApproved: false, hasFailed: true })).toBe(
      "The approval didn't go through. Please try again."
    )
    expect(getSafeOwnerApprovalFailureMessage({ isApproved: true, hasFailed: false })).toBe(
      'The transaction changed after it was approved. Please approve it again.'
    )
    expect(getSafeOwnerApprovalFailureMessage({ isApproved: false, hasFailed: false })).toBe(
      "The approval isn't confirmed yet. Check its status in your activity before approving again."
    )
  })
})
