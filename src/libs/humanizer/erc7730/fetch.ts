import { BindedRelayerCall } from '@/libs/relayerCall/relayerCall'
import { withTimeout } from '@/utils/with-timeout'

import { ERC7730_DESCRIPTOR_WAIT_MS } from './consts'

const getRelayerPayload = <T>(response: any, path: string): T => {
  if (response?.success === false) {
    throw new Error(`Failed to fetch ERC-7730 relayer resource: ${path}`)
  }

  if (response?.data !== undefined) return response.data as T
  if (response?.success === undefined) return response as T

  const { success, status, errorState, message, ...payload } = response
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`)
  }

  return payload as T
}

/**
 * Fetch and validate the resource from the relayer.
 * We have this wrapper mainly because of the validate method
 */
export const fetchRelayerResource = async <T>(
  path: string,
  method: string,
  callRelayer: BindedRelayerCall,
  validate: (payload: unknown, path: string) => payload is T,
  body?: any
): Promise<T> => {
  const response = await withTimeout(
    () => callRelayer(path, method, body, undefined, ERC7730_DESCRIPTOR_WAIT_MS),
    {
      timeoutMs: ERC7730_DESCRIPTOR_WAIT_MS,
      message: `Timed out fetching ERC-7730 relayer resource: ${path}`
    }
  )
  const payload = getRelayerPayload<T>(response, path)

  if (!validate(payload, path)) {
    throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`)
  }

  return payload
}
