import { Fetch } from '../../interfaces/fetch'

export async function fetchUserOp(userOpHash: string, fetchFn: Fetch) {
  const url = `https://api.jiffyscan.xyz/v0/getUserOp?hash=${userOpHash}`

  return Promise.race([
    fetchFn(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.REACT_APP_JIFFYSCAN_API_KEY || ''
      }
    }),
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('jiffy scan timeout')), 2500)
    })
  ]).catch((e) => {
    console.log(e)
    return null
  })
}
