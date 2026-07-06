import { expect, jest } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { RPCProvider } from '../../interfaces/provider'
import * as deploylessModule from '../../libs/deployless/deployless'
import * as providerModule from '../provider'
import { reverseLookupEns } from './ensDomains'

const STUB_PROVIDER = {} as RPCProvider

const makeAddress = (index: number) => `0x${(index + 1).toString(16).padStart(40, '0')}`

describe('reverseLookupEns (batched + CCIP fallback)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('chunks the addresses into batched eth_calls of at most 100', async () => {
    const callMock = jest
      .fn<(method: string, args: any[]) => Promise<any>>()
      .mockImplementation(async (_method, args) => {
        const addressChunk = args[1] as string[]
        return addressChunk.map(() => ({
          resolvedName: '',
          hasName: false,
          needsOffchainLookup: false
        }))
      })
    jest
      .spyOn(deploylessModule, 'fromDescriptor')
      .mockReturnValue({ call: callMock } as unknown as deploylessModule.Deployless)

    const addresses = Array.from({ length: 150 }, (_, i) => makeAddress(i))
    const result = await reverseLookupEns(addresses, STUB_PROVIDER)

    expect(callMock).toHaveBeenCalledTimes(2)
    expect((callMock.mock.calls[0]![1][1] as string[]).length).toBe(100)
    expect((callMock.mock.calls[1]![1][1] as string[]).length).toBe(50)
    expect(Object.keys(result).length).toBe(150)
    expect(result[addresses[0]!]).toEqual({ name: null, failed: false })
  })

  it('isolates a failed chunk: only its addresses are marked failed', async () => {
    const { restore } = suppressConsole(true)
    const callMock = jest
      .fn<(method: string, args: any[]) => Promise<any>>()
      .mockImplementationOnce(async (_method, args) =>
        (args[1] as string[]).map(() => ({
          resolvedName: '',
          hasName: false,
          needsOffchainLookup: false
        }))
      )
      .mockRejectedValueOnce(new Error('rpc timeout'))
    jest
      .spyOn(deploylessModule, 'fromDescriptor')
      .mockReturnValue({ call: callMock } as unknown as deploylessModule.Deployless)

    const addresses = Array.from({ length: 150 }, (_, i) => makeAddress(i))
    const result = await reverseLookupEns(addresses, STUB_PROVIDER)

    // First chunk (100) succeeded, second chunk (50) failed.
    expect(result[addresses[0]!]).toEqual({ name: null, failed: false })
    expect(result[addresses[100]!]).toEqual({ name: null, failed: true })
    restore()
  })

  it('falls back to viem getEnsName for addresses flagged needsOffchainLookup (CCIP)', async () => {
    const offchainAddress = makeAddress(0)
    const onchainAddress = makeAddress(1)

    const callMock = jest.fn<(method: string, args: any[]) => Promise<any>>().mockResolvedValue([
      { resolvedName: '', hasName: false, needsOffchainLookup: true },
      { resolvedName: 'onchain.eth', hasName: true, needsOffchainLookup: false }
    ])
    jest
      .spyOn(deploylessModule, 'fromDescriptor')
      .mockReturnValue({ call: callMock } as unknown as deploylessModule.Deployless)

    const getEnsNameMock = jest
      .fn<(args: any) => Promise<string | null>>()
      .mockResolvedValue('offchain.eth')
    jest
      .spyOn(providerModule, 'getViemClientForProvider')
      .mockReturnValue({ getEnsName: getEnsNameMock } as any)

    const result = await reverseLookupEns([offchainAddress, onchainAddress], STUB_PROVIDER)

    expect(getEnsNameMock).toHaveBeenCalledTimes(1)
    expect((getEnsNameMock.mock.calls[0]![0] as any).address).toBe(offchainAddress)
    expect(result[offchainAddress]).toEqual({ name: 'offchain.eth', failed: false })
    expect(result[onchainAddress]).toEqual({ name: 'onchain.eth', failed: false })
  })

  it('marks an address failed if the CCIP fallback itself fails', async () => {
    const { restore } = suppressConsole(true)
    const offchainAddress = makeAddress(0)

    const callMock = jest
      .fn<(method: string, args: any[]) => Promise<any>>()
      .mockResolvedValue([{ resolvedName: '', hasName: false, needsOffchainLookup: true }])
    jest
      .spyOn(deploylessModule, 'fromDescriptor')
      .mockReturnValue({ call: callMock } as unknown as deploylessModule.Deployless)

    const getEnsNameMock = jest
      .fn<(args: any) => Promise<string | null>>()
      .mockRejectedValue(new Error('gateway unreachable'))
    jest
      .spyOn(providerModule, 'getViemClientForProvider')
      .mockReturnValue({ getEnsName: getEnsNameMock } as any)

    const result = await reverseLookupEns([offchainAddress], STUB_PROVIDER)

    expect(result[offchainAddress]).toEqual({ name: null, failed: true })
    restore()
  })
})
