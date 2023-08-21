import { ethers } from 'hardhat'
import { JsonRpcProvider } from 'ethers'
import { addressOne, addressTwo, abiCoder, AmbireAccount } from './config'
import { Storage } from '../src/interfaces/storage'
import { parse, stringify } from '../src/libs/bigintJson/bigintJson'

async function sendFunds(to: string, ether: number) {
  const [signer] = await ethers.getSigners()
  await signer.sendTransaction({
    to,
    value: ethers.parseEther(ether.toString())
  })
}

function getPriviledgeTxn(ambireAccountAddr: string, privAddress: string, hasPriv: boolean = true) {
  const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
  const iface = new ethers.Interface(setAddrPrivilegeABI)
  const priv = hasPriv ? 1 : 0
  const calldata = iface.encodeFunctionData('setAddrPrivilege', [
    privAddress,
    ethers.toBeHex(priv, 32)
  ])
  return [ambireAccountAddr, 0, calldata]
}

const timelock = 1 // a 1 second timelock default
const defaultRecoveryInfo = [[addressOne, addressTwo], timelock]
function getTimelockData(recoveryInfo = defaultRecoveryInfo) {
  const hash = ethers.keccak256(abiCoder.encode(['tuple(address[], uint)'], [recoveryInfo]))
  const timelockAddress = `0x${hash.slice(hash.length - 40, hash.length)}`
  return { hash, timelockAddress }
}

async function getNonce(ambireAccountAddr: string, provider: JsonRpcProvider) {
  const accountContract = new ethers.Contract(ambireAccountAddr, AmbireAccount.abi, provider)
  return accountContract.nonce()
}

function getDKIMValidatorData(
  parsedContents: any,
  signer: any,
  options: any = {}
) {
  const emptySecondSig = options.emptySecondSig ?? false
  const acceptEmptyDKIMSig = options.acceptEmptyDKIMSig ?? false
  const onlyOneSigTimelock = options.onlyOneSigTimelock ?? 0
  const acceptUnknownSelectors = options.acceptUnknownSelectors ?? false
  const emailFrom = options.emailFrom ?? 'tt469695@gmail.com'
  const emailTo = options.emailTo ?? 'adamcrein@gmail.com'
  const selector = options.selector ?? `${parsedContents[0].selector}._domainkey.gmail.com`

  return abiCoder.encode([
    'tuple(string,string,string,bytes,bytes,address,bool,uint32,uint32,bool,bool,uint32)'
    ,
  ], [[
    emailFrom,
    emailTo,
    selector,
    ethers.hexlify(parsedContents[0].modulus),
    ethers.hexlify(ethers.toBeHex(parsedContents[0].exponent)),
    signer.address,
    acceptUnknownSelectors,
    0,
    0,
    acceptEmptyDKIMSig,
    emptySecondSig,
    onlyOneSigTimelock,
  ]])
}

function getSignerKey(validatorAddr: any, validatorData: any) {
  const hash = ethers.keccak256(abiCoder.encode(['address', 'bytes'], [validatorAddr, validatorData]))
  const signerKey = `0x${hash.slice(hash.length - 40, hash.length)}`
  return {signerKey, hash}
}

function produceMemoryStore(): Storage {
  const storage = new Map()
  return {
    get: (key, defaultValue): any => {
      const serialized = storage.get(key)
      return Promise.resolve(serialized ? parse(serialized) : defaultValue)
    },
    set: (key, value) => {
      storage.set(key, stringify(value))
      return Promise.resolve(null)
    }
  }
}

export { sendFunds, getPriviledgeTxn, getTimelockData, getNonce, getDKIMValidatorData, getSignerKey, produceMemoryStore }
