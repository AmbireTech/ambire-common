function hexStringToUint8Array(hexString: string) {
  // Remove '0x' prefix if present
  if (hexString.startsWith('0x')) {
    // eslint-disable-next-line no-param-reassign
    hexString = hexString.slice(2)
  }

  // Ensure the hex string has an even length
  if (hexString.length % 2 !== 0) {
    throw new Error('Hex string must have an even number of characters')
  }

  const uint8Array = new Uint8Array(hexString.length / 2)

  for (let i = 0; i < hexString.length; i += 2) {
    const byteValue = parseInt(hexString.substr(i, 2), 16)
    uint8Array[i / 2] = byteValue
  }

  return uint8Array
}

export default hexStringToUint8Array
