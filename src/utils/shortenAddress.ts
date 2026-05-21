const shortenAddress = (
  address: string,
  maxLength: number = 30,
  useFixedSizeVisibleChars?: number
): string => {
  if (address.length <= maxLength) return address

  if (useFixedSizeVisibleChars && address.startsWith('0x')) {
    const maxVisibleCharsByLength = Math.max(Math.floor((maxLength - 5) / 2), 1)
    const visibleChars = Math.min(useFixedSizeVisibleChars, maxVisibleCharsByLength)
    const addressBody = address.slice(2)
    return `0x${addressBody.slice(0, visibleChars)}...${addressBody.slice(-visibleChars)}`
  }

  return `${address.slice(0, maxLength / 2 - 1)}...${address.slice(-maxLength / 2 + 2)}`
}

export default shortenAddress
