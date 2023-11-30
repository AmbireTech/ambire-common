/**
 * Returns a `Boolean` on whether or not the a `String` starts with '0x'
 */
export const isHexPrefixed = (str: string) => {
  if (typeof str !== 'string') {
    throw new Error(
      `isHexPrefixed \`str\` value must be type 'string', is currently type ${typeof str}`
    )
  }

  return str.slice(0, 2) === '0x'
}
