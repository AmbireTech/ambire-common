import { ethers } from 'ethers'

import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { AccountOp } from '../../accountOp/accountOp'

describe('ERC-7730 registry cache', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  test('does not call the relayer again when a calldata descriptor is cached', async () => {
    const { fetchErc7730DescriptorForCall } =
      jest.requireActual<typeof import('./registry')>('./registry')
    const contractAddress = '0x1111111111111111111111111111111111111111'
    const registryPath = 'registry/test/calldata-cache.json'
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:1:${contractAddress}`]: registryPath
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })

        return {
          success: true,
          display: {
            formats: {
              'test()': {
                intent: 'Cached calldata descriptor',
                fields: []
              }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })

    const firstDescriptor = await fetchErc7730DescriptorForCall(
      {
        to: contractAddress,
        value: 0n,
        data: '0x12345678'
      },
      1n as AccountOp['chainId'],
      { callRelayer }
    )

    expect(firstDescriptor?.path).toBe(registryPath)
    expect(callRelayer).toHaveBeenCalledTimes(2)

    callRelayer.mockClear()

    const cachedDescriptor = await fetchErc7730DescriptorForCall(
      {
        to: contractAddress,
        value: 0n,
        data: '0x12345678'
      },
      1n as AccountOp['chainId'],
      { callRelayer }
    )

    expect(cachedDescriptor?.path).toBe(registryPath)
    expect(callRelayer).not.toHaveBeenCalled()
  })

  test('does not call the relayer again when an EIP-712 descriptor is cached', async () => {
    const { fetchErc7730DescriptorForMessage } =
      jest.requireActual<typeof import('./registry')>('./registry')
    const verifyingContract = '0x2222222222222222222222222222222222222222'
    const registryPath = 'registry/test/eip712-cache.json'
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/eip-712') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:1:${verifyingContract}`]: {
              Permit: [{ path: registryPath }]
            }
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })

        return {
          success: true,
          display: {
            formats: {
              'Permit(address owner,address spender,uint256 value)': {
                intent: 'Cached EIP-712 descriptor',
                fields: []
              }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const message = {
      fromRequestId: 1,
      accountAddr: '0x3333333333333333333333333333333333333333',
      content: {
        kind: 'typedMessage',
        domain: {
          name: 'Cached Permit',
          chainId: 1,
          verifyingContract
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' }
          ]
        },
        primaryType: 'Permit',
        message: {
          owner: '0x3333333333333333333333333333333333333333',
          spender: '0x4444444444444444444444444444444444444444',
          value: 1n
        }
      },
      signature: null,
      chainId: 1n
    }

    const firstDescriptor = await fetchErc7730DescriptorForMessage(message as any, callRelayer)

    expect(firstDescriptor?.path).toBe(registryPath)
    expect(callRelayer).toHaveBeenCalledTimes(2)

    callRelayer.mockClear()

    const cachedDescriptor = await fetchErc7730DescriptorForMessage(message as any, callRelayer)

    expect(cachedDescriptor?.path).toBe(registryPath)
    expect(callRelayer).not.toHaveBeenCalled()
  })

  test('reuses a cached descriptor resource for the same relayer path', async () => {
    const { fetchErc7730DescriptorForCall, fetchErc7730DescriptorForMessage } =
      jest.requireActual<typeof import('./registry')>('./registry')
    const contractAddress = '0x5555555555555555555555555555555555555555'
    const registryPath = 'registry/test/shared-descriptor-cache.json'
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:1:${contractAddress}`]: registryPath
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/eip-712') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:1:${contractAddress}`]: {
              Permit: [{ path: registryPath }]
            }
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })

        return {
          success: true,
          display: {
            formats: {
              'Permit(address owner,address spender,uint256 value)': {
                intent: 'Shared cached descriptor',
                fields: []
              }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const message = {
      fromRequestId: 1,
      accountAddr: '0x3333333333333333333333333333333333333333',
      content: {
        kind: 'typedMessage',
        domain: {
          name: 'Cached Permit',
          chainId: 1,
          verifyingContract: contractAddress
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' }
          ]
        },
        primaryType: 'Permit',
        message: {
          owner: '0x3333333333333333333333333333333333333333',
          spender: '0x4444444444444444444444444444444444444444',
          value: 1n
        }
      },
      signature: null,
      chainId: 1n
    }

    const firstDescriptor = await fetchErc7730DescriptorForCall(
      {
        to: contractAddress,
        value: 0n,
        data: '0x12345678'
      },
      1n as AccountOp['chainId'],
      { callRelayer }
    )

    expect(firstDescriptor?.path).toBe(registryPath)
    expect(callRelayer).toHaveBeenCalledTimes(2)
    expect(callRelayer).toHaveBeenCalledWith(
      '/v2/erc7730/fetch-descriptor',
      'POST',
      {
        descriptorPath: `/${registryPath}`
      },
      undefined,
      4000
    )

    callRelayer.mockClear()

    const cachedDescriptor = await fetchErc7730DescriptorForMessage(message as any, callRelayer)

    expect(cachedDescriptor?.path).toBe(registryPath)
    expect(callRelayer).toHaveBeenCalledTimes(1)
    expect(callRelayer).toHaveBeenCalledWith(
      '/v2/erc7730/eip-712',
      'GET',
      undefined,
      undefined,
      4000
    )
  })

  test('does not crash while resolving a call without calldata', async () => {
    const { fetchErc7730DescriptorForCall } =
      jest.requireActual<typeof import('./registry')>('./registry')

    const descriptor = await fetchErc7730DescriptorForCall(
      {
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        data: undefined
      } as any,
      1n as AccountOp['chainId']
    )

    expect(descriptor).toBe(null)
  })

  test('does not keep a hanging relayer index promise cached', async () => {
    const { fetchErc7730DescriptorForCall } =
      jest.requireActual<typeof import('./registry')>('./registry')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const callRelayer = jest.fn(() => new Promise(() => {}))

    jest.useFakeTimers()

    try {
      const firstDescriptor = fetchErc7730DescriptorForCall(
        {
          to: '0x1111111111111111111111111111111111111111',
          value: 0n,
          data: '0x12345678'
        },
        1n as AccountOp['chainId'],
        { callRelayer }
      )

      await jest.advanceTimersByTimeAsync(4000)
      await expect(firstDescriptor).resolves.toBe(null)
      expect(callRelayer).toHaveBeenCalledTimes(1)

      const secondDescriptor = fetchErc7730DescriptorForCall(
        {
          to: '0x1111111111111111111111111111111111111111',
          value: 0n,
          data: '0x12345678'
        },
        1n as AccountOp['chainId'],
        { callRelayer }
      )

      await jest.advanceTimersByTimeAsync(4000)
      await expect(secondDescriptor).resolves.toBe(null)
      expect(callRelayer).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
      consoleErrorSpy.mockRestore()
    }
  })

  test('resolves a SafeTx descriptor by reading the Safe proxy singleton', async () => {
    const { fetchErc7730DescriptorForMessage } =
      jest.requireActual<typeof import('./registry')>('./registry')
    const safeProxy = '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce'
    const safeSingleton = '0x41675c099f32341bf84bfc5382af534df5c7461a'
    const registryPath = 'registry/safe/dynamic-safe-version.json'
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/eip-712') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:8453:${safeSingleton}`]: {
              SafeTx: [
                {
                  path: registryPath,
                  encodeTypeHashes: [
                    '0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8'
                  ]
                }
              ]
            }
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {},
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })

        return {
          success: true,
          display: {
            formats: {
              'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)':
                {
                  intent: 'Safe transaction',
                  fields: []
                }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const provider = {
      getStorage: jest.fn(async (address: string, slot: bigint) => {
        expect(address).toBe(safeProxy)
        expect(slot).toBe(0n)

        return `0x000000000000000000000000${safeSingleton.slice(2)}`
      })
    }
    const safeTxMessage = {
      fromRequestId: 1,
      accountAddr: '0x3333333333333333333333333333333333333333',
      content: {
        kind: 'typedMessage',
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' }
          ]
        },
        domain: {
          verifyingContract: safeProxy,
          chainId: 8453
        },
        message: {
          to: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
          value: '0',
          data: '0xa9059cbb000000000000000000000000a04d21b7ae298d8e4a61a507de2b7ceafd90ba010000000000000000000000000000000000000000000000000000000000000064',
          operation: 0,
          baseGas: '0',
          gasPrice: '0',
          gasToken: '0x0000000000000000000000000000000000000000',
          refundReceiver: '0x0000000000000000000000000000000000000000',
          nonce: 81,
          safeTxGas: '0'
        },
        primaryType: 'SafeTx'
      },
      signature: null,
      chainId: 8453n
    }

    const descriptor = await fetchErc7730DescriptorForMessage(
      safeTxMessage as any,
      callRelayer,
      provider as any
    )

    expect(descriptor?.path).toBe(registryPath)
    expect(descriptor?.safeTxCallDescriptor?.path).toBe('built-in/erc20-transfer')
    expect(provider.getStorage).toHaveBeenCalledTimes(1)
    expect(callRelayer).toHaveBeenCalledTimes(3)
  })

  test('resolves per-transaction descriptors for a SafeTx multisend', async () => {
    const { fetchErc7730DescriptorForMessage } =
      jest.requireActual<typeof import('./registry')>('./registry')
    const safeProxy = '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce'
    const safeSingleton = '0x41675c099f32341bf84bfc5382af534df5c7461a'
    const tokenAddress = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'
    const recipientOne = '0xa04d21b7ae298d8e4a61a507de2b7ceafd90ba01'
    const recipientTwo = '0xd8293ad21678c6f09da139b4b62d38e514a03b78'
    const registryPath = 'registry/safe/dynamic-safe-version.json'
    const transferDataOne = `0xa9059cbb000000000000000000000000${recipientOne.slice(
      2
    )}0000000000000000000000000000000000000000000000000000000000000064`
    const transferDataTwo = `0xa9059cbb000000000000000000000000${recipientTwo.slice(
      2
    )}00000000000000000000000000000000000000000000000000000000000000c8`
    const transactionsData = ethers.concat([
      ethers.solidityPacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, tokenAddress, 0n, BigInt(ethers.getBytes(transferDataOne).length), transferDataOne]
      ),
      ethers.solidityPacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, tokenAddress, 0n, BigInt(ethers.getBytes(transferDataTwo).length), transferDataTwo]
      )
    ])
    const multiSendData = new ethers.Interface([
      'function multiSend(bytes transactions)'
    ]).encodeFunctionData('multiSend', [transactionsData])
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/eip-712') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {
            [`eip155:8453:${safeSingleton}`]: {
              SafeTx: [
                {
                  path: registryPath,
                  encodeTypeHashes: [
                    '0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8'
                  ]
                }
              ]
            }
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/account-op') {
        expect(method).toBe('GET')

        return {
          success: true,
          data: {},
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })

        return {
          success: true,
          display: {
            formats: {
              'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)':
                {
                  intent: 'Safe transaction',
                  fields: []
                }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const provider = {
      getStorage: jest.fn(async (address: string, slot: bigint) => {
        expect(address).toBe(safeProxy)
        expect(slot).toBe(0n)

        return `0x000000000000000000000000${safeSingleton.slice(2)}`
      })
    }
    const safeTxMessage = {
      fromRequestId: 1,
      accountAddr: '0x3333333333333333333333333333333333333333',
      content: {
        kind: 'typedMessage',
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' }
          ]
        },
        domain: {
          verifyingContract: safeProxy,
          chainId: 8453
        },
        message: {
          to: '0x8d80ff0a632a8a7ba2e219e2c4b79f8f3cd2d81b',
          value: '0',
          data: multiSendData,
          operation: 1,
          baseGas: '0',
          gasPrice: '0',
          gasToken: '0x0000000000000000000000000000000000000000',
          refundReceiver: '0x0000000000000000000000000000000000000000',
          nonce: 81,
          safeTxGas: '0'
        },
        primaryType: 'SafeTx'
      },
      signature: null,
      chainId: 8453n
    }

    const descriptor = await fetchErc7730DescriptorForMessage(
      safeTxMessage as any,
      callRelayer,
      provider as any
    )

    expect(descriptor?.path).toBe(registryPath)
    expect(descriptor?.safeTxCallDescriptor).toBeUndefined()
    expect(descriptor?.safeTxCallDescriptors?.[0]?.path).toBe('built-in/erc20-transfer')
    expect(descriptor?.safeTxCallDescriptors?.[1]?.path).toBe('built-in/erc20-transfer')
    expect(provider.getStorage).toHaveBeenCalledTimes(1)
  })

  test('does not keep a hanging Safe singleton promise cached', async () => {
    const { fetchErc7730DescriptorForMessage } =
      jest.requireActual<typeof import('./registry')>('./registry')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const safeProxy = '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce'
    const callRelayer = jest.fn(async (path: string) => {
      if (path === '/v2/erc7730/eip-712') {
        return {
          success: true,
          data: {},
          errorState: []
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const provider = {
      getStorage: jest.fn(() => new Promise(() => {}))
    }
    const safeTxMessage = {
      fromRequestId: 1,
      accountAddr: '0x3333333333333333333333333333333333333333',
      content: {
        kind: 'typedMessage',
        types: {
          EIP712Domain: [
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' }
          ]
        },
        domain: {
          verifyingContract: safeProxy,
          chainId: 8453
        },
        message: {
          to: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
          value: '0',
          data: '0xa9059cbb000000000000000000000000a04d21b7ae298d8e4a61a507de2b7ceafd90ba010000000000000000000000000000000000000000000000000000000000000064',
          operation: 0,
          baseGas: '0',
          gasPrice: '0',
          gasToken: '0x0000000000000000000000000000000000000000',
          refundReceiver: '0x0000000000000000000000000000000000000000',
          nonce: 81,
          safeTxGas: '0'
        },
        primaryType: 'SafeTx'
      },
      signature: null,
      chainId: 8453n
    }

    jest.useFakeTimers()

    try {
      const firstDescriptor = fetchErc7730DescriptorForMessage(
        safeTxMessage as any,
        callRelayer as any,
        provider as any
      )

      await jest.advanceTimersByTimeAsync(4000)
      await expect(firstDescriptor).resolves.toBe(null)
      expect(provider.getStorage).toHaveBeenCalledTimes(1)

      const secondDescriptor = fetchErc7730DescriptorForMessage(
        safeTxMessage as any,
        callRelayer as any,
        provider as any
      )

      await jest.advanceTimersByTimeAsync(4000)
      await expect(secondDescriptor).resolves.toBe(null)
      expect(provider.getStorage).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
      consoleErrorSpy.mockRestore()
    }
  })

  test('rejects malformed index responses', async () => {
    const { fetchErc7730DescriptorForCall, fetchErc7730DescriptorForMessage } =
      jest.requireActual<typeof import('./registry')>('./registry')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const callRelayer = jest.fn(async (path: string) => {
      if (path === '/v2/erc7730/account-op') {
        return {
          success: true,
          data: {
            'not-a-registry-key': 'registry/test/calldata-cache.json'
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/eip-712') {
        return {
          success: true,
          data: {
            'eip155:1:0x2222222222222222222222222222222222222222': {
              Permit: [{ path: 'registry/test/eip712-cache.json', encodeTypeHashes: ['0x1234'] }]
            }
          },
          errorState: []
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const message = {
      fromRequestId: 1,
      accountAddr: '0x3333333333333333333333333333333333333333',
      content: {
        kind: 'typedMessage',
        domain: {
          name: 'Cached Permit',
          chainId: 1,
          verifyingContract: '0x2222222222222222222222222222222222222222'
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' }
          ]
        },
        primaryType: 'Permit',
        message: {
          owner: '0x3333333333333333333333333333333333333333',
          spender: '0x4444444444444444444444444444444444444444',
          value: 1n
        }
      },
      signature: null,
      chainId: 1n
    }

    try {
      const calldataDescriptor = await fetchErc7730DescriptorForCall(
        {
          to: '0x1111111111111111111111111111111111111111',
          value: 0n,
          data: '0x12345678'
        },
        1n as AccountOp['chainId'],
        { callRelayer }
      )
      const eip712Descriptor = await fetchErc7730DescriptorForMessage(message as any, callRelayer)

      expect(calldataDescriptor).toBe(null)
      expect(eip712Descriptor).toBe(null)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  test('does not cache malformed descriptor responses', async () => {
    const { fetchErc7730DescriptorForMessage } =
      jest.requireActual<typeof import('./registry')>('./registry')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const verifyingContract = '0x6666666666666666666666666666666666666666'
    const registryPath = 'registry/test/malformed-descriptor-cache.json'
    let descriptorRequests = 0
    const callRelayer = jest.fn(async (path: string, method?: string, body?: any) => {
      if (path === '/v2/erc7730/eip-712') {
        return {
          success: true,
          data: {
            [`eip155:1:${verifyingContract}`]: {
              Permit: [{ path: registryPath }]
            }
          },
          errorState: []
        }
      }

      if (path === '/v2/erc7730/fetch-descriptor') {
        expect(method).toBe('POST')
        expect(body).toEqual({ descriptorPath: `/${registryPath}` })
        descriptorRequests += 1

        if (descriptorRequests === 1) {
          return {
            success: true,
            display: {
              formats: {
                'Permit(address owner,address spender,uint256 value)': {
                  intent: 'Malformed descriptor',
                  fields: 'not-an-array'
                }
              }
            }
          }
        }

        return {
          success: true,
          display: {
            formats: {
              'Permit(address owner,address spender,uint256 value)': {
                intent: 'Valid descriptor',
                fields: []
              }
            }
          }
        }
      }

      throw new Error(`Unexpected ERC-7730 relayer call: ${path}`)
    })
    const message = {
      fromRequestId: 1,
      accountAddr: '0x3333333333333333333333333333333333333333',
      content: {
        kind: 'typedMessage',
        domain: {
          name: 'Cached Permit',
          chainId: 1,
          verifyingContract
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' }
          ]
        },
        primaryType: 'Permit',
        message: {
          owner: '0x3333333333333333333333333333333333333333',
          spender: '0x4444444444444444444444444444444444444444',
          value: 1n
        }
      },
      signature: null,
      chainId: 1n
    }

    try {
      const malformedDescriptor = await fetchErc7730DescriptorForMessage(
        message as any,
        callRelayer
      )
      const validDescriptor = await fetchErc7730DescriptorForMessage(message as any, callRelayer)

      expect(malformedDescriptor).toBe(null)
      expect(validDescriptor?.path).toBe(registryPath)
      expect(descriptorRequests).toBe(2)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
