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
      callRelayer
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
      callRelayer
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
      callRelayer
    )

    expect(firstDescriptor?.path).toBe(registryPath)
    expect(callRelayer).toHaveBeenCalledTimes(2)
    expect(callRelayer).toHaveBeenCalledWith('/v2/erc7730/fetch-descriptor', 'POST', {
      descriptorPath: `/${registryPath}`
    })

    callRelayer.mockClear()

    const cachedDescriptor = await fetchErc7730DescriptorForMessage(message as any, callRelayer)

    expect(cachedDescriptor?.path).toBe(registryPath)
    expect(callRelayer).toHaveBeenCalledTimes(1)
    expect(callRelayer).toHaveBeenCalledWith('/v2/erc7730/eip-712', 'GET')
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
        callRelayer
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
