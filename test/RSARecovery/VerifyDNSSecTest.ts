import { ethers } from 'hardhat'

let validator
describe('VerifyDNSSecTest', function () {
  it('should successfully deploy the dnssec validator', async function () {
    validator = await ethers.deployContract('DNSSecValidator', ['0x00002b000100000e1000244a5c080249aac11d7b6f6446702e54a1607371607a1a41855200fd2ce1cdde32f24e8fb500002b000100000e1000244f660802e06d44b80b8f1d39a95c0b0d7c65d08458e880409bbc683457104237c7f8ec8d'])
  })
  it('should successfully validate a dnssec record', async function() {
    
  })
})
