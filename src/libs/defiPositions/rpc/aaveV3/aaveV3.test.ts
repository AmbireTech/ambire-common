import { Contract } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../../../consts/networks'
import { getRpcProvider } from '../../../../services/provider'
import { AAVE_STATIC_CALL_TIMEOUT_MS, getAAVEPositions } from './aaveV3'

// If this test ever fails because the account removes its positions, find another
// account with AAVE v3 positions on Ethereum (e.g. on https://debank.com/protocols/aave3/holders)
const userAddrAave = '0xe40d278afd00e6187db21ff8c96d572359ef03bf'

const ethereum = networks.find((n) => n.chainId === 1n)
if (!ethereum) throw new Error('unable to find ethereum network in consts')

const providerEthereum = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)

/** Whether a deployless call sent the contract's code as a state override (a 3rd `eth_call` param) */
const hasUsedStateOverride = (sendSpy: { mock: { calls: unknown[][] } }) =>
  sendSpy.mock.calls.some(
    ([method, params]) => method === 'eth_call' && Array.isArray(params) && params.length === 3
  )

describe('AAVE v3 positions read from the chain', () => {
  test('Get AAVE positions on Ethereum', async () => {
    const aavePositions = await getAAVEPositions(userAddrAave, providerEthereum, ethereum)

    expect(aavePositions).not.toBeNull()
    if (aavePositions !== null) {
      const pos1 = aavePositions.positions[0]!
      expect(pos1.additionalData.healthRate).toBeGreaterThan(1)
    }
  })
  test('AAVE returns prices, health rate, additional date and asset value', async () => {
    const aavePositions = await getAAVEPositions(userAddrAave, providerEthereum, ethereum)
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    const pos = aavePositions?.positions[0]!
    if (!pos) throw new Error('no positions found')

    expect(aavePositions?.positionInUSD).toBeGreaterThan(0)
    expect(pos.additionalData.positionInUSD).toBeGreaterThan(0)
    expect(pos.additionalData.healthRate).toBeGreaterThan(0)
    expect(pos.additionalData.collateralInUSD).toBeGreaterThan(0)
  })
  // The contract deploys its helper contracts in its constructor, which doesn't run with a state
  // override, so the positions would fail to load
  test.each([
    ['an RPC that supports state override', false],
    ['an RPC without state override', true]
  ])(
    'sends the contract with the call, never as a state override, on %s',
    async (_, rpcNoStateOverride) => {
      const sendSpy = jest.spyOn(providerEthereum, 'send')

      try {
        const aavePositions = await getAAVEPositions(userAddrAave, providerEthereum, {
          ...ethereum,
          rpcNoStateOverride
        })

        expect(aavePositions).not.toBeNull()
        expect(hasUsedStateOverride(sendSpy)).toBe(false)
      } finally {
        sendSpy.mockRestore()
      }
    }
  )
  test('AAVE getReservesCount times out instead of hanging forever', async () => {
    jest.useFakeTimers()
    const getFunctionSpy = jest.spyOn(Contract.prototype, 'getFunction').mockReturnValue({
      staticCall: () => new Promise(() => {})
    } as ReturnType<Contract['getFunction']>)

    try {
      const promise = getAAVEPositions(userAddrAave, providerEthereum, ethereum)
      const expectation = expect(promise).rejects.toThrow(/took too long/i)
      await jest.advanceTimersByTimeAsync(AAVE_STATIC_CALL_TIMEOUT_MS + 50)
      await expectation
    } finally {
      getFunctionSpy.mockRestore()
      jest.useRealTimers()
    }
  })
})
