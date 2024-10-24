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
  message: String
}

export async function requestMagicLink(
  email: String,
  relayerUrl: String,
  fetch: Fetch,
  options?: { autoConfirm?: boolean; flow?: MagicLinkFlow }
): Promise<MagicLinkData> {
  const flow = options?.flow

  const resp = await fetch(
    `${relayerUrl}/email-vault/request-key/${email}${flow ? `?flow=${flow}` : ''}`
  )
  const result: RequestMagicLinkResult = await resp.json()
  if (result?.data?.secret && options?.autoConfirm)
    setTimeout(() => {
      fetch(
        `${relayerUrl}/email-vault/confirm-key/${email}/${result.data.key}/${result.data.secret}`
      )
    }, 2000)

  if (!result.success) throw new Error(`magicLink: error getting magic link: ${result.message}`)
  return result.data
}
