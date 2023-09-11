import { Wallet, Contract, JsonRpcProvider, ethers } from 'ethers'
import { wrapEthSign } from '../../test/ambireSign'
import AMBIRE_ACCOUNT from '../../contracts/compiled/AmbireAccount.json'
import { networks } from '../../src/consts/networks'
require('dotenv').config();

const abiCoder = new ethers.AbiCoder()
const optimismUrl = 'https://rpc.ankr.com/optimism'
const provider = new JsonRpcProvider(optimismUrl)
const SENDER_ADDR = '0x8D14d902bC13E1EDB1A8Dfa2DE2187D4EF77f0aF'

function getExecuteCalldata(txns: any, sig: string) {
  const abi = ['function execute(tuple(address, uint256, bytes)[] calldata calls, bytes calldata signature) public payable']
  const iface = new ethers.Interface(abi)
  return iface.encodeFunctionData('execute', [txns, sig])
}

async function secondTxn() {
  const pk: any = process.env.DEPLOY_PRIVATE_KEY
  const signer = new Wallet(pk, provider)
  const ambireAccount = new Contract(SENDER_ADDR, AMBIRE_ACCOUNT.abi, provider)
  const anotherTxn = [SENDER_ADDR, 0, '0x68656c6c6f']
  const optimism = networks.find((x) => x.id === 'optimism')
  if (!optimism) throw new Error('unable to find optimism network in consts')
  const msg = ethers.getBytes(
    ethers.keccak256(
      abiCoder.encode(
        ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
        [SENDER_ADDR, optimism.chainId, await ambireAccount.nonce(), [anotherTxn]]
      )
    )
  )
  const s = wrapEthSign(await signer.signMessage(msg))
  const gasPrice = await provider.send('eth_gasPrice', [])
  const initCode = getExecuteCalldata([anotherTxn], s)
  const txnResult = await signer.sendTransaction({
    to: SENDER_ADDR,
    value: 0,
    data: initCode,
    gasPrice: gasPrice,
    gasLimit: ethers.toBeHex(120000)
  });
  console.log(txnResult)
}

secondTxn()
