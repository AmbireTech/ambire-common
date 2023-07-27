function getLable(content: string) {
  return { type: 'lable', content }
}
function getAction(content: string) {
  return { type: 'action', content }
}
function getAddress(address: string, name?: string) {
  return name ? { type: 'address', address, name } : { type: 'address', address }
}

function getToken(address: string, amount: bigint) {
  return { type: 'token', address, amount }
}

function getNft(address: string, id: bigint) {
  return { type: 'nft', address, id }
}

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

export { getLable, getAction, getAddress, getToken, getNft, getRecipientText, parsePath }
