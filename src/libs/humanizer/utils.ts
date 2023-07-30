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

const getDeadlineText = (deadlineSecs: number, mined = false) => {
  if (mined) return getLable('')
  const minute = 60000
  const deadline = deadlineSecs * 1000
  const diff = deadline - Date.now()
  if (diff < 0 && diff > -minute * 2) return getLable(', expired just now')
  // Disabled this: this is a bit of a hack cause we don't want it to show for mined txns
  // we don't really need it for pending ones, simply because we'll show the big error message instead
  // if (diff < 0) return getLable(`, expired ${Math.floor(-diff / minute)} minutes ago`
  if (diff < 0) return getLable('')
  if (diff < minute) return getLable(', expires in less than a minute')
  if (diff < 10 * minute) return getLable(`, expires in ${Math.floor(diff / minute)} minutes`)
  return getLable('')
}

const shortenAddress = (addr: string) => {
  return addr ? `${addr.slice(0, 5)}...${addr.slice(-3)}` : ''
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
