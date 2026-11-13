import { getBytes, hexlify } from 'ethers'

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { RPCProvider } from '../../interfaces/provider'
import { fromDescriptor } from '../deployless/deployless'
import { checkKohakuFingerprints, getAmbireAccountCodeHashes } from './kohakuFingerprints'

jest.mock('../deployless/deployless', () => ({ fromDescriptor: jest.fn() }))

const mockedFromDescriptor = fromDescriptor as jest.MockedFunction<typeof fromDescriptor>
const provider = {} as RPCProvider

/**
 * Seen on Ethereum for an EOA delegated to `EIP_7702_AMBIRE_ACCOUNT`, a `PROXY_AMBIRE_ACCOUNT`
 * proxy and a `PROXY_AMBIRE_V1_ACCOUNT` proxy.
 */
const OBSERVED_7702_CODE_HASH = '0xd8ef78646344da0ceb69cbcdb306939b3ba0514174fa28b6c6fa189953ff226d'
const OBSERVED_PROXY_CODE_HASH =
  '0x613fa5f4773c121236aa7119a4f2c9fd0e06777a21cc10192836670ae3341912'
const OBSERVED_V1_PROXY_CODE_HASH =
  '0x1e30cfc34cd01db953dd5aab9d0a3101ec11d92a8c0ac8a91b045a2356945103'

const toAddress = (i: number) => `0xab${(i + 1).toString(16).padStart(38, '0')}`

const mockDeploylessCall = (
  call: (method: string, args: any[]) => Promise<unknown>
): jest.Mock<(method: string, args: any[]) => Promise<unknown>> => {
  const callMock = jest.fn(call)
  mockedFromDescriptor.mockReturnValue({ call: callMock } as any)

  return callMock
}

describe('getAmbireAccountCodeHashes', () => {
  test('includes the code hashes seen on Ambire accounts on chain', () => {
    const codeHashes = getAmbireAccountCodeHashes()

    expect(codeHashes).toContain(OBSERVED_7702_CODE_HASH)
    expect(codeHashes).toContain(OBSERVED_PROXY_CODE_HASH)
    expect(codeHashes).toContain(OBSERVED_V1_PROXY_CODE_HASH)
  })
})

describe('checkKohakuFingerprints', () => {
  test('splits the addresses into batches and maps every flag to its own address', async () => {
    // Every third address is an Ambire account, so a shifted flag maps to the wrong address
    const addresses = Array.from({ length: 1001 }, (_, i) => toAddress(i))
    const isAmbire = (address: string) => addresses.indexOf(address) % 3 === 0
    const callMock = mockDeploylessCall(async (_method, [packedAddrs]) => {
      const bytes = getBytes(packedAddrs)
      const batch = Array.from({ length: bytes.length / 20 }, (_, i) =>
        hexlify(bytes.slice(i * 20, (i + 1) * 20))
      )

      return hexlify(new Uint8Array(batch.map((address) => (isAmbire(address) ? 1 : 0))))
    })

    const result = await checkKohakuFingerprints({
      provider,
      supportsStateOverride: true,
      addresses: addresses.map((address) => address.toUpperCase().replace('0X', '0x'))
    })

    expect(callMock).toHaveBeenCalledTimes(2)
    expect(getBytes(callMock.mock.calls[0]![1][0]).length).toBe(1000 * 20)
    expect(getBytes(callMock.mock.calls[1]![1][0]).length).toBe(20)
    expect(result.size).toBe(addresses.length)
    const wrongAddresses = addresses.filter((address) => result.get(address) !== isAmbire(address))
    expect(wrongAddresses).toEqual([])
  })

  test('throws when the flags do not match the addresses', async () => {
    mockDeploylessCall(async () => '0x01')

    await expect(
      checkKohakuFingerprints({
        provider,
        supportsStateOverride: true,
        addresses: [toAddress(0), toAddress(1)]
      })
    ).rejects.toThrow('1 depositor flags came back for 2 addresses')
  })

  describe('when the network fails', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    test('retries a failed batch', async () => {
      const callMock = mockDeploylessCall(async () => '0x01')
      callMock.mockRejectedValueOnce(new Error('rate limited'))

      const resultPromise = checkKohakuFingerprints({
        provider,
        supportsStateOverride: false,
        addresses: [toAddress(0)]
      })
      await jest.runAllTimersAsync()

      await expect(resultPromise).resolves.toEqual(new Map([[toAddress(0), true]]))
      expect(callMock).toHaveBeenCalledTimes(2)
    })

    test('throws after the last attempt', async () => {
      const callMock = mockDeploylessCall(async () => {
        throw new Error('rpc down')
      })

      const resultPromise = checkKohakuFingerprints({
        provider,
        supportsStateOverride: true,
        addresses: [toAddress(0)]
      })
      const assertion = expect(resultPromise).rejects.toThrow('rpc down')
      await jest.runAllTimersAsync()

      await assertion
      expect(callMock).toHaveBeenCalledTimes(4)
    })
  })
})
