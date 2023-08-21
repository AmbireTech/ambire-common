/*
  parse and return email data
  (nodejs)
*/
import { parse } from './parse'
import getPublicKey from './getPublicKey'
import publicKeyToComponents from './publicKeyToComponents'
import toSolidity from './toSolidity'
import { createHash } from 'crypto'

export default async function parseEmail(email: any) {

  const dkims = parse(email).dkims.map((dkim: any) => {
    const algorithm = dkim.algorithm
      .split('-')
      .pop()
      .toUpperCase()

    const bodyHash = createHash(algorithm)
      .update(dkim.processedBody)
      .digest()

    const bodyHashMatched = bodyHash.compare(dkim.signature.hash) !== 0

    if (bodyHashMatched) {
      throw new Error('body hash did not verify')
    }

    const hash = createHash(algorithm)
      .update(dkim.processedHeader)
      .digest()

    return {
      ...dkim,
      hash
    }
  })

  // get dns records
  const publicKeysEntries: any = await Promise.all(
    dkims.map((dkim: any) =>
      getPublicKey({
        domain: dkim.signature.domain,
        selector: dkim.signature.selector
      })
    )
  )

  const publicKeys = publicKeysEntries.map((entry: any) => {
    const { publicKey } = entry
    const { exponent, modulus } = publicKeyToComponents(publicKey)

    return {
      ...entry,
      exponent,
      modulus
    }
  })

  return dkims.map((dkim: any, i: any) => {
    const solidity = toSolidity({
      algorithm: dkim.algorithm,
      hash: dkim.hash,
      signature: dkim.signature.signature,
      exponent: publicKeys[i].exponent,
      modulus: publicKeys[i].modulus
    })

    return {
      ...dkim,
      ...publicKeys[i],
      solidity
    }
  })
}
