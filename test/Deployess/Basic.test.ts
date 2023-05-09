import { AbiCoder, JsonRpcProvider, concat, getDefaultProvider, randomBytes, toBeHex } from 'ethers'
import { Deployless, DeploylessMode } from '../../v2/libs/deployless/deployless'
import { compile } from '../../v2/libs/deployless/compile'
import { addressOne, expect, localhost } from '../config'
import { assertion } from '../config'

const helloWorld = compile('HelloWorld', {
  contractsFolder: 'test/contracts'
})
const deployErrBin = '0x6080604052348015600f57600080fd5b600080fdfe'
const localhostProvider = new JsonRpcProvider(localhost)
const mainnetProvider = new JsonRpcProvider('https://rpc.ankr.com/eth')
let deployless: Deployless

describe('Deployless', () => {
  it('should construct an object', () => {
    deployless = new Deployless(localhostProvider, helloWorld.abi, helloWorld.bytecode)
    expect(deployless.isLimitedAt24kbData).to.equal(true)
  })

  it('should invoke a method: proxy mode', async () => {
    const [ result ] = await deployless.call('helloWorld', [], { mode: DeploylessMode.ProxyContract })
    expect(result).to.equal('hello world')
    // We still haven't detected support for state override
    expect(deployless.isLimitedAt24kbData).to.equal(true)
  })

  it('should invoke a method: detect mode', async () => {
    deployless = new Deployless(mainnetProvider, helloWorld.abi, helloWorld.bytecode)
    const [ result ] = await deployless.call('helloWorld', [])
    expect(result).to.equal('hello world')
    // We detected support for state override
    expect(deployless.isLimitedAt24kbData).to.equal(false)
  })

  it('should not allow detect with another Provider', async () => {
    assertion.expectExpects(1)
    const homesteadProvider = getDefaultProvider('homestead')
    const deployless = new Deployless(homesteadProvider, helloWorld.abi, helloWorld.bytecode)
    try { await deployless.call('helloWorld', []) } catch (e: any) {
      expect(e.message).to.equal('state override mode (or auto-detect) not available unless you use JsonRpcProvider')
    }
  })

  it('should deploy error: proxy mode', async () => {
    const deployless = new Deployless(localhostProvider, helloWorld.abi, deployErrBin)
    assertion.expectExpects(1)
    try { await deployless.call('helloWorld', [], { mode: DeploylessMode.ProxyContract }) } catch (e: any) {
      expect(e.message).to.equal('contract deploy failed')
    }
  })

  it('should deploy error: state override mode', async () => {
    const deployless = new Deployless(mainnetProvider, helloWorld.abi, deployErrBin)
    assertion.expectExpects(2)
    try { await deployless.call('helloWorld', []) } catch (e: any) {
      expect(e.message).to.equal('contract deploy failed')
      // detection stil succeeded
      expect(deployless.isLimitedAt24kbData).to.equal(false)
    }
  })

  it('should deploy error: state override without detection', async () => {
    const deployless = new Deployless(mainnetProvider, helloWorld.abi, helloWorld.bytecode, helloWorld.deployBytecode)
    // we should already be aware that we are not limited by the 24kb limit
    expect(deployless.isLimitedAt24kbData).to.equal(false)
    const [ result ] = await deployless.call('helloWorld', [], { mode: DeploylessMode.StateOverride })
    expect(result).to.equal('hello world')
    const [ result2 ] = await deployless.call('helloWorld', [])
    expect(result2).to.equal('hello world')
  })

  it('should custom block tag', async () => {
    const deployless = new Deployless(mainnetProvider, helloWorld.abi, helloWorld.bytecode, helloWorld.deployBytecode)
    assertion.expectExpects(2)
    try { await deployless.call('helloWorld', [], { blockTag: '0x1' }) } catch (e: any) {
      // we are relying on the fact that we do not have the SHR opcode in block 0x1
      expect(e.info.error.message.includes('invalid opcode: SHR')).to.equal(true)
    }
    try { await deployless.call('helloWorld', [], { blockTag: '0x1', mode: DeploylessMode.ProxyContract }) } catch (e: any) {
      // ethers wraps the error if we use the Provider; perhaps we should un-wrap it
      // fails with out-of-gas when wrapped in the ProxyContract mode
      expect(e.info.error.message.includes('out of gas')).to.equal(true)
    }
  })

  it('should compile a contract', async () => {
    const json = compile('AmbireAccount')
    expect(json).to.haveOwnProperty('abi').to.not.be.null
    expect(json).to.haveOwnProperty('bytecode').to.not.be.null
    expect(json).to.haveOwnProperty('deployBytecode').to.not.be.null
  })

  it('should throw an error for max 24 kb contract size in DeploylessMode.ProxyContract and not throw it in DeploylessMode.StateOverride', async () => {
    assertion.expectExpects(2)
    const factory = compile('AmbireAccountFactory')
    const abiCoder = new AbiCoder()
    const bytecodeAndArgs = toBeHex(
      concat([
        factory.bytecode,
        abiCoder.encode(['address'], [addressOne])
      ])
    );
    let megaLargeCode = bytecodeAndArgs;
    let i = 8
    while (i > 0) {
      megaLargeCode += bytecodeAndArgs.substring(2)
      i--
    }
    const contract = new Deployless(localhostProvider, factory.abi, megaLargeCode, factory.deployBytecode)
    try { await contract.call('deploy', [bytecodeAndArgs, '1234'], {mode: DeploylessMode.ProxyContract}) } catch (e: any) {
      expect(e.message).to.equal('24kb call data size limit reached, use StateOverride mode')
    }
    try { await contract.call('deploy', [bytecodeAndArgs, '1234'], {mode: DeploylessMode.StateOverride}) } catch (e: any) {
      expect(e.message).to.not.equal('24kb call data size limit reached, use StateOverride mode')
    }
  })

  it('should throw an solidity assert error', async function() {
    assertion.expectExpects(1)
    const contract = new Deployless(mainnetProvider, helloWorld.abi, helloWorld.bytecode, helloWorld.deployBytecode)
    try { await contract.call('throwAssertError', []) } catch(e: any) {
      expect(e).to.equal('solidity assert error')
    }
  })

  it('should throw an arithmetic error', async function() {
    assertion.expectExpects(1)
    const contract = new Deployless(mainnetProvider, helloWorld.abi, helloWorld.bytecode, helloWorld.deployBytecode)
    try { await contract.call('throwArithmeticError', []) } catch(e: any) {
      expect(e.message).to.equal('arithmetic error')
    }
  })

  it('should throw a division by zero error', async function() {
    assertion.expectExpects(1)
    const contract = new Deployless(mainnetProvider, helloWorld.abi, helloWorld.bytecode, helloWorld.deployBytecode)
    try { await contract.call('throwDivisionByZeroError', []) } catch(e: any) {
      expect(e).to.equal('division by zero')
    }
  })

  it('should throw a panic error', async function() {
    assertion.expectExpects(1)
    const contract = new Deployless(mainnetProvider, helloWorld.abi, helloWorld.bytecode, helloWorld.deployBytecode)
    try { await contract.call('throwCompilerPanic', []) } catch(e: any) {
      expect(e).to.equal('panic error: 0x32')
    }
  })
})
