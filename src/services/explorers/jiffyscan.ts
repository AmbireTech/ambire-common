import { Fetch } from '../../interfaces/fetch'

export async function fetchUserOp(userOpHash: string, fetchFn: Fetch) {
  const url = `https://api.jiffyscan.xyz/v0/getUserOp?hash=${userOpHash}`

  return fetchFn(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.REACT_APP_JIFFYSCAN_API_KEY || ''
    }
  })
}
