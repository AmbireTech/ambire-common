export type DecodedCall = {
  args: { key: string; val: DecodedArgument }[]
  selector: string
  signature: string
  data: string
  diffInBytes: number
}

type DecodedArgument = bigint | string | boolean | DecodedCall['args'] | DecodedCall
