import { MagicLinkFlow } from '../../interfaces/emailVault'
import { Fetch } from '../../interfaces/fetch'

export interface MagicLinkData {
  key: string
  secret?: String // this will not be return in prod mode
  expiry: number
}

export interface RequestMagicLinkResult {
  success: Boolean
  data: MagicLinkData
  message: string
}

export async function requestMagicLink(
  email: string,
  relayerUrl: string,
  fetch: Fetch,
  options?: { autoConfirm?: boolean; flow?: MagicLinkFlow }
): Promise<MagicLinkData> {
  const flow = options?.flow

  const resp = await fetch(
    `${relayerUrl}/email-vault/request-key/${email}${flow ? `?flow=${flow}` : ''}`
  )
  let result: RequestMagicLinkResult
  try {
    result = await resp.json()
  } catch {
    throw new Error('Relayer is down.')
  }
  if (result?.data?.secret && options?.autoConfirm)
    setTimeout(() => {
      fetch(
        `${relayerUrl}/email-vault/confirm-key/${email}/${result.data.key}/${result.data.secret}`
      )
    }, 2000)

  if (!result.success) throw new Error(result.message)
  return result.data
}
