import { Fetch } from '../../interfaces/fetch'

export async function fetchUserOp(
  userOpHash: string,
  fetchFn: Fetch,
  explorerNetworkId: string | null = null
) {
  let url = `https://api.jiffyscan.xyz/v0/getUserOp?hash=${userOpHash}`
  if (explorerNetworkId) url += `&network=${explorerNetworkId}`

  return fetchFn(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.REACT_APP_JIFFYSCAN_API_KEY || ''
    }
  })
}
