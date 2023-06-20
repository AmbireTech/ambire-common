export interface MagicLinkData {
  key: String
  secret: String // this will not be return in prod mode
}

export interface RequestMagicLinkResult {
  success: Boolean
  data: MagicLinkData
  message: String
}

export async function requestMagicLink(
  email: String,
  relayerUrl: String,
  fetch: Function
): Promise<MagicLinkData> {
  const resp = await fetch(`${relayerUrl}/email-vault/requestKey/${email}`)
  const result: RequestMagicLinkResult = await resp.json()

  if (!result.success) throw new Error(`magicLink: error getting magic link: ${result.message}`)
  return result.data
}
