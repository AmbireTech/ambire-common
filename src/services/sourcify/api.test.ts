import { expect, jest } from '@jest/globals'

import { Fetch } from '../../interfaces/fetch'
import { SourcifyAPI } from './api'

describe('SourcifyAPI', () => {
  test('requests all contract fields for a checksummed address', async () => {
    const responseBody = {
      chainId: '1',
      address: '0x000000000000000000000000000000000000dEaD',
      match: 'exact_match'
    }

    // @ts-ignore
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody
    }) as unknown as Fetch

    const api = new SourcifyAPI({ fetch, baseUrl: 'https://sourcify.dev/server' })
    const result = await api.getContract(1n, '0x000000000000000000000000000000000000dead')

    expect(fetch).toHaveBeenCalledWith(
      'https://sourcify.dev/server/v2/contract/1/0x000000000000000000000000000000000000dEaD?fields=all',
      {
        headers: {
          Accept: 'application/json'
        }
      }
    )
    expect(result).toEqual(responseBody)
  })

  test('surfaces upstream json error messages', async () => {
    // @ts-ignore
    const fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      clone: () => ({
        json: async () => ({ error: 'Contract not found' }),
        text: async () => '{"error":"Contract not found"}'
      }),
      json: async () => ({ error: 'Contract not found' }),
      text: async () => '{"error":"Contract not found"}'
    }) as unknown as Fetch

    const api = new SourcifyAPI({ fetch })

    await expect(api.getContract(1n, '0x000000000000000000000000000000000000dEaD')).rejects.toThrow(
      'Sourcify request failed with status 404: Contract not found'
    )
  })

  test('throws a helpful error for invalid json responses', async () => {
    // @ts-ignore
    const fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('Unexpected token < in JSON')
      }
    }) as unknown as Fetch

    const api = new SourcifyAPI({ fetch })

    await expect(api.getContract(1n, '0x000000000000000000000000000000000000dEaD')).rejects.toThrow(
      'Failed to parse Sourcify contract response: Unexpected token < in JSON'
    )
  })
})
