import { ethers } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { suppressConsole } from '../../../../test/helpers/console'
import {
  getTestErc7730DescriptorForCall,
  getTestErc7730Errors,
  getTestErc7730MessageDescriptor,
  SAFE_PROXY_V1_4_1_RUNTIME_CODE
} from '../../../controllers/erc7730/testDescriptors'
import { AccountOp } from '../../accountOp/accountOp'
import { resolveErc7730Call, resolveIncludePath } from './registry'
import { EMPTY_ERC7730_KNOWN, Erc7730Registry } from './types'

describe('ERC-7730 registry', () => {
  test('does not crash while resolving a call without calldata', () => {
    const { descriptor } = resolveErc7730Call(
      {
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        data: undefined
      } as any,
      1n as AccountOp['chainId'],
      EMPTY_ERC7730_KNOWN
    )

    expect(descriptor).toBe(null)
  })

  test('resolves a SafeTx descriptor by reading the Safe proxy singleton', async () => {
    const safeProxy = '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce'
    const safeSingleton = '0x41675c099f32341bf84bfc5382af534df5c7461a'
    const registryPath = 'registry/safe/dynamic-safe-version.json'
    const registry: Erc7730Registry = {
      calldataIndex: {},
      eip712Index: {
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
      descriptors: {
        [registryPath]: {
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
    }
    const provider = {
      getCode: jest.fn(async () => SAFE_PROXY_V1_4_1_RUNTIME_CODE),
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

    const descriptor = await getTestErc7730MessageDescriptor(
      safeTxMessage as any,
      registry,
      provider as any
    )

    expect(descriptor?.path).toBe(registryPath)
    expect(descriptor?.innerCallDescriptors?.[0]?.path).toBe('built-in/erc20-transfer')
    expect(provider.getStorage).toHaveBeenCalledTimes(1)
  })

  test('resolves per-transaction descriptors for a SafeTx multisend', async () => {
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
    const registry: Erc7730Registry = {
      calldataIndex: {},
      eip712Index: {
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
      descriptors: {
        [registryPath]: {
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
    }
    const provider = {
      getCode: jest.fn(async () => SAFE_PROXY_V1_4_1_RUNTIME_CODE),
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

    const descriptor = await getTestErc7730MessageDescriptor(
      safeTxMessage as any,
      registry,
      provider as any
    )

    expect(descriptor?.path).toBe(registryPath)
    expect(descriptor?.innerCallDescriptors?.[0]?.path).toBe('built-in/erc20-transfer')
    expect(descriptor?.innerCallDescriptors?.[1]?.path).toBe('built-in/erc20-transfer')
    expect(provider.getStorage).toHaveBeenCalledTimes(1)
  })

  test('does not keep a hanging Safe singleton promise cached', async () => {
    const { restore } = suppressConsole()
    const safeProxy = '0x714fd3db837e72bd49b8eda02b8f4d53dfdde5ce'
    const registry: Erc7730Registry = {
      calldataIndex: {},
      eip712Index: {},
      descriptors: {}
    }
    const provider = {
      getCode: jest.fn(async () => SAFE_PROXY_V1_4_1_RUNTIME_CODE),
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
      const firstDescriptor = getTestErc7730MessageDescriptor(
        safeTxMessage as any,
        registry,
        provider as any
      )

      await jest.advanceTimersByTimeAsync(4000)
      await expect(firstDescriptor).resolves.toBe(null)
      expect(provider.getStorage).toHaveBeenCalledTimes(1)

      const secondDescriptor = getTestErc7730MessageDescriptor(
        safeTxMessage as any,
        registry,
        provider as any
      )

      await jest.advanceTimersByTimeAsync(4000)
      await expect(secondDescriptor).resolves.toBe(null)
      expect(provider.getStorage).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
    restore()
  })

  test('reports and ignores a malformed descriptor', async () => {
    const { restore } = suppressConsole()
    const verifyingContract = '0x6666666666666666666666666666666666666666'
    const registryPath = 'registry/test/malformed-descriptor.json'
    const registry: Erc7730Registry = {
      calldataIndex: {},
      eip712Index: {
        [`eip155:1:${verifyingContract}`]: {
          Permit: [{ path: registryPath }]
        }
      },
      descriptors: {
        [registryPath]: {
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
    }
    const message = {
      fromRequestId: 1,
      accountAddr: '0x3333333333333333333333333333333333333333',
      content: {
        kind: 'typedMessage',
        domain: {
          name: 'Test Permit',
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

    const malformedDescriptor = await getTestErc7730MessageDescriptor(message as any, registry)

    expect(malformedDescriptor).toBe(null)
    expect(getTestErc7730Errors(registry)).toHaveLength(1)
    restore()
  })
})

describe('ERC-7730 test helpers', () => {
  test('a lookup without a provider does not take the provider away from a later one', async () => {
    const safeProxy = '0x2222222222222222222222222222222222222222'
    const safeSingleton = '0x41675c099f32341bf84bfc5382af534df5c7461a'
    const safePath = 'registry/safe/calldata-Safe-1.4.1.json'
    const registry: Erc7730Registry = {
      calldataIndex: { [`eip155:1:${safeSingleton}`]: safePath },
      eip712Index: {},
      descriptors: {
        [safePath]: { display: { formats: { 'test()': { intent: 'Safe test', fields: [] } } } }
      }
    }
    const provider = {
      getCode: jest.fn(async () => SAFE_PROXY_V1_4_1_RUNTIME_CODE),
      getStorage: jest.fn(async () => `0x000000000000000000000000${safeSingleton.slice(2)}`)
    }
    const call = { to: safeProxy, value: 0n, data: '0x12345678' }

    // Asking for the errors creates no controller, and the lookup without a provider gets one of
    // its own - so neither leaves a provider-less controller for the lookup with a provider
    expect(getTestErc7730Errors(registry, provider)).toEqual([])
    await expect(getTestErc7730DescriptorForCall(call, 1n, registry)).resolves.toBeNull()

    const descriptor = await getTestErc7730DescriptorForCall(call, 1n, registry, provider)

    expect(descriptor?.path).toBe(safePath)
    expect(provider.getCode).toHaveBeenCalledTimes(1)
  })
})

describe('resolveIncludePath', () => {
  const PARENT_PATH = 'registry/morpho/calldata-vault.json'

  test('resolves an include next to the descriptor that includes it', () => {
    expect(resolveIncludePath('common-VaultV1.json', PARENT_PATH)).toBe(
      '/registry/morpho/common-VaultV1.json'
    )
    expect(resolveIncludePath('./common-VaultV1.json', `/${PARENT_PATH}`)).toBe(
      '/registry/morpho/common-VaultV1.json'
    )
  })

  test('goes up a folder for each `..`', () => {
    expect(resolveIncludePath('../../ercs/eip712-erc2612-permit.json', PARENT_PATH)).toBe(
      '/ercs/eip712-erc2612-permit.json'
    )
  })

  test('resolves an include with a leading slash from the root of the registry', () => {
    expect(resolveIncludePath('/ercs/calldata-erc20-tokens.json', PARENT_PATH)).toBe(
      '/ercs/calldata-erc20-tokens.json'
    )
  })

  test('keeps the plain file name, unlike a URL', () => {
    expect(resolveIncludePath('common a.json', PARENT_PATH)).toBe('/registry/morpho/common a.json')
    expect(resolveIncludePath('common#1.json', PARENT_PATH)).toBe('/registry/morpho/common#1.json')
    expect(resolveIncludePath('common?v=1.json', PARENT_PATH)).toBe(
      '/registry/morpho/common?v=1.json'
    )
    expect(resolveIncludePath('commön.json', PARENT_PATH)).toBe('/registry/morpho/commön.json')
  })

  test('never goes above the root of the registry', () => {
    expect(resolveIncludePath('../../../../../outside.json', PARENT_PATH)).toBe('/outside.json')
  })
})
