import { ethers } from 'ethers'

function getLable(content: string) {
  return { type: 'lable', content }
}
function getAction(content: string) {
  return { type: 'action', content }
}
function getAddress(_address: string, name?: string) {
  const address = ethers.getAddress(_address)
  return name ? { type: 'address', address, name } : { type: 'address', address }
}

function getToken(_address: string, amount: bigint) {
  const address = ethers.getAddress(_address)
  return { type: 'token', address, amount }
}

function getNft(address: string, id: bigint) {
  return { type: 'nft', address, id }
}

// @TODO on some humanization of uniswap there is recipient 0x000...000
const getRecipientText = (from: string, recipient: string) =>
  from.toLowerCase() === recipient.toLowerCase()
    ? []
    : [getLable('and send it to'), getAddress(recipient)]

const parsePath = (pathBytes: any) => {
  // some decodePacked fun
  // can we do this with Ethers AbiCoder? probably not
  const path = []
  // address, uint24
  for (let i = 2; i < pathBytes.length; i += 46) {
    path.push(`0x${pathBytes.substr(i, 40)}`)
  }
  return path
}

const getDeadlineText = (deadlineSecs: bigint, mined = false) => {
  if (mined) return null
  const minute = 60000
  const deadline = Number(deadlineSecs * 1000n)
  const diff = deadline - Date.now()
  if (diff < 0 && diff > -minute * 2) return getLable('expired just now')
  // Disabled this: this is a bit of a hack cause we don't want it to show for mined txns
  // we don't really need it for pending ones, simply because we'll show the big error message instead
  // if (diff < 0) return getLable(`, expired ${Math.floor(-diff / minute)} minutes ago`
  if (diff < 0) return getLable('already expired')
  if (diff < minute) return getLable('expires in less than a minute')
  if (diff < 10 * minute) return getLable(`expires in ${Math.floor(diff / minute)} minutes`)
  return null
}

const shortenAddress = (addr: string) => {
  return addr ? `${addr.slice(0, 5)}...${addr.slice(-3)}` : null
}

export {
  getLable,
  getAction,
  getAddress,
  getToken,
  getNft,
  getRecipientText,
  parsePath,
  getDeadlineText,
  shortenAddress
}
