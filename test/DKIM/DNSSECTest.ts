import { ethers } from 'hardhat'

import getPublicKey from '../../src/libs/dkim/getPublicKey'
import publicKeyToComponents from '../../src/libs/dkim/publicKeyToComponents'
import lookup from '../../src/libs/dns/lookup'
import { abiCoder, expect } from '../config'

const SignedSet = require('@ensdomains/dnsprovejs').SignedSet

function hexEncodeSignedSet(rrs: any, sig: any) {
  const ss = new SignedSet(rrs, sig)
  return [ss.toWire(), ss.signature.data.signature]
}

let dkimRecovery: any

describe('DKIM', () => {
  it('successfully deploy the DNSSEC contracts and DKIM Recovery', async () => {
    const [signer] = await ethers.getSigners()

    const dnsSec = await ethers.deployContract('DNSSECImpl', [
      '0x00002b000100000e1000244a5c080249aac11d7b6f6446702e54a1607371607a1a41855200fd2ce1cdde32f24e8fb500002b000100000e1000244f660802e06d44b80b8f1d39a95c0b0d7c65d08458e880409bbc683457104237c7f8ec8d00002b000100000e10000404fefdfd'
    ])

    const rsaSha256 = await ethers.deployContract('RSASHA256Algorithm')
    await dnsSec.setAlgorithm(8, await rsaSha256.getAddress())

    // other algo
    const rsaSha256Other = await ethers.deployContract('RSASHA256')

    const p256SHA256Algorithm = await ethers.deployContract('P256SHA256Algorithm')
    await dnsSec.setAlgorithm(13, await p256SHA256Algorithm.getAddress())

    const digest = await ethers.deployContract('SHA256Digest')
    await dnsSec.setDigest(2, await digest.getAddress())

    const contractFactory = await ethers.getContractFactory('DKIMRecoverySigValidator', {
      libraries: {
        RSASHA256: await rsaSha256Other.getAddress()
      }
    })
    dkimRecovery = await contractFactory.deploy(
      await dnsSec.getAddress(),
      signer.address,
      signer.address
    )
    expect(await dkimRecovery.getAddress()).to.not.be.null
  })

  it('successfully add a DNS key through addDKIMKeyWithDNSSec', async () => {
    const res = await lookup('Google', 'Ambire.com')
    const rrsets = res.proofs.map(({ records, signature }: any) =>
      hexEncodeSignedSet(records, signature)
    )
    const set = hexEncodeSignedSet(res.answer.records, res.answer.signature)
    rrsets.push(set)
    await dkimRecovery.addDKIMKeyWithDNSSec(rrsets)

    const ambireKey = await getPublicKey({ domain: 'Ambire.com', selector: 'Google' })
    const key = publicKeyToComponents(ambireKey.publicKey)
    const ambireExponent = ethers.hexlify(ethers.toBeHex(key.exponent))
    const ambireModulus = ethers.hexlify(key.modulus)
    const result = await dkimRecovery.getDomainNameFromSet(rrsets[rrsets.length - 1])
    const domainName = result[0]
    const dkimHash = ethers.keccak256(
      abiCoder.encode(
        ['tuple(string, bytes, bytes)'],
        [[domainName, ambireModulus, ambireExponent]]
      )
    )
    const isResThere = await dkimRecovery.dkimKeys(dkimHash)
    expect(isResThere[0]).to.be.true
  })
})
