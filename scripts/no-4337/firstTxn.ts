import { Wallet, ethers } from 'ethers'
import { get4437Bytecode } from '../../src/libs/proxyDeploy/bytecode'
import { networks } from '../../src/consts/networks'
import { wrapEthSign } from '../../test/ambireSign'
import AmbireAccountFactory from "../../contracts/compiled/AmbireAccountFactory.json";
require('dotenv').config();

const OPTIMISM_FACTORY_ADDR = '0x4cBbC8E4936F37225871a6660934F15c377A4134'
const ENTRY_POINT_ADDR = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'
const abiCoder = new ethers.AbiCoder()
const salt = '0x0'

function getAmbireAccountAddress(factoryAddress: string, bytecode: string) {
  return ethers.getCreate2Address(factoryAddress, ethers.toBeHex(salt, 32), ethers.keccak256(bytecode))
}

function getPriviledgeTxn(ambireAccountAddr: string, privAddress: string, privHash: string) {
  const setAddrPrivilegeABI = ['function setAddrPrivilege(address addr, bytes32 priv)']
  const iface = new ethers.Interface(setAddrPrivilegeABI)
  const calldata = iface.encodeFunctionData('setAddrPrivilege', [
    privAddress,
    privHash
  ])
  return [ambireAccountAddr, 0, calldata]
}

async function deployAndExecute() {
  const optimism = networks.find((x) => x.id === 'optimism')
  if (!optimism) throw new Error('unable to find optimism network in consts')
  const pk: any = process.env.DEPLOY_PRIVATE_KEY
  const provider = new ethers.JsonRpcProvider(optimism.rpcUrl)
  const signer = new Wallet(pk, provider)
  const secondKeyAddr = ethers.computeAddress(ethers.hexlify(ethers.randomBytes(32)))
  const privs = [
    { addr: signer.address, hash: true },
    { addr: secondKeyAddr, hash: true }
  ]
  const bytecodeWithArgs = await get4437Bytecode(optimism, privs)
  const senderAddress = getAmbireAccountAddress(OPTIMISM_FACTORY_ADDR, bytecodeWithArgs)

  const anotherTxn = [senderAddress, 0, '0x68656c6c6f']
  const txn = getPriviledgeTxn(senderAddress, ENTRY_POINT_ADDR, '0x42144640c7cb5ff8aa9595ae175ffcb6dd152db6e737c13cc2d5d07576967020')
  const gasPrice = await provider.send('eth_gasPrice', [])
  const msg = ethers.getBytes(
    ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [senderAddress, optimism.chainId, 0, [txn, anotherTxn]]
      )
    )
  )
  const s = wrapEthSign(await signer.signMessage(msg))
  const factoryContract = new ethers.Contract(OPTIMISM_FACTORY_ADDR, AmbireAccountFactory.abi, signer)
  const finished = await factoryContract.deployAndExecute(bytecodeWithArgs, salt, [txn, anotherTxn], s, {
    gasPrice: gasPrice,
    gasLimit: ethers.toBeHex(1000000)
  })
  console.log(finished)
}

deployAndExecute()
