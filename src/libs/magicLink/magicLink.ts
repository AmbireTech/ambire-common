export interface MagicLinkData {
  key: string
  secret?: String // this will not be return in prod mode
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

  if (result?.data?.secret)
    await fetch(
      `${relayerUrl}/email-vault/confirmationKey/${email}/${result.data.key}/${result.data.secret}`
    )

  if (!result.success) throw new Error(`magicLink: error getting magic link: ${result.message}`)
  return result.data
}
