/**
 * Compares two addresses ignoring case. Doesn't throw on a malformed address, e.g. one read
 * from storage.
 */
const isSameAddr = (one: string, two: string) => one.toLowerCase() === two.toLowerCase()

export default isSameAddr
