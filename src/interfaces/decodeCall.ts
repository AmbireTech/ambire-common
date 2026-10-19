export type DecodedCall = {
  args: { key: string; val: DecodedArgument }[]
  selector: string
  signature: string
  diffInBytes: number
}

type DecodedArgument = bigint | string | boolean | DecodedCall['args'] | DecodedCall

/**
 * The call data decoded as deep as the known signatures allow. `decodedCall` is null when the
 * top level call can't be decoded. `selectors` holds every selector that was looked up on the way.
 */
export type RecursivelyDecodedCallData = {
  decodedCall: DecodedCall | null
  selectors: string[]
}
