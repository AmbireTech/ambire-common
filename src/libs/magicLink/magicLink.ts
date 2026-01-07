import { MagicLinkFlow } from '../../interfaces/emailVault'
import { Fetch } from '../../interfaces/fetch'
import { relayerCall } from '../relayerCall/relayerCall'

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
  const callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
  const flow = options?.flow

  const result: RequestMagicLinkResult = await callRelayer(
    `/email-vault/request-key/${email}${flow ? `?flow=${flow}` : ''}`
  )

  // This is only for testing purposes, which acts as email confirmation
  if (result?.data?.secret && options?.autoConfirm)
    setTimeout(() => {
      // We don't use `relayerCall` here because this request returns HTML without a `success` flag,
      // which would wrongly throw RELAYER_DOWN error in the tests.
      fetch(
        `${relayerUrl}/email-vault/confirm-key/${email}/${result.data.key}/${result.data.secret}`
      )
    }, 2000)

  return result.data
}
