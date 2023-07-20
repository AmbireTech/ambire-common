import { ethers } from 'hardhat'
const { SignedSet } = require('@ensdomains/dnsprovejs/dist/index')

const validityPeriod = 2419200
const expiration = Date.now() / 1000 - 15 * 60 + validityPeriod
const inception = Date.now() / 1000 - 15 * 60

function hexEncodeSignedSet(keys: any) {
  const ss = new SignedSet(keys.rrs, keys.sig)
  return [ss.toWire(), ss.signature.data.signature]
}

function rootKeys(expiration: any, inception: any): any {
  var name = '.'
  var sig = {
    name: '.',
    type: 'RRSIG',
    ttl: 0,
    class: 'IN',
    flush: false,
    data: {
      typeCovered: 'DNSKEY',
      algorithm: 253,
      labels: 0,
      originalTTL: 3600,
      expiration,
      inception,
      keyTag: 1278,
      signersName: '.',
      signature: Buffer.from([]),
    },
  }

  var rrs = [
    {
      name: '.',
      type: 'DNSKEY',
      class: 'IN',
      ttl: 3600,
      data: { flags: 0, algorithm: 253, key: Buffer.from('0000', 'hex') },
    },
    {
      name: '.',
      type: 'DNSKEY',
      class: 'IN',
      ttl: 3600,
      data: { flags: 0, algorithm: 253, key: Buffer.from('1112', 'hex') },
    },
    {
      name: '.',
      type: 'DNSKEY',
      class: 'IN',
      ttl: 3600,
      data: {
        flags: 0x0101,
        algorithm: 253,
        key: Buffer.from('0000', 'hex'),
      },
    },
  ]
  return { name, sig, rrs }
}

let validator: any
describe('VerifyDNSSecTest', function () {
  it('should successfully deploy the dnssec validator', async function () {
    validator = await ethers.deployContract('DNSSecValidator', ['0x00002b000100000e1000244a5c080249aac11d7b6f6446702e54a1607371607a1a41855200fd2ce1cdde32f24e8fb500002b000100000e1000244f660802e06d44b80b8f1d39a95c0b0d7c65d08458e880409bbc683457104237c7f8ec8d'])
  })
  it('should successfully validate a dnssec record', async function() {
    var keys = rootKeys(expiration, inception)
    const rrsets = hexEncodeSignedSet(keys)
    const response = await validator.verifyRRSet(rrsets)
    console.log(response)
  })
})
