import { Wallet, Contract, JsonRpcProvider, ethers } from 'ethers'
import { wrapEthSign } from '../../test/ambireSign'
import AMBIRE_ACCOUNT from '../../contracts/compiled/AmbireAccount.json'
import { networks } from '../../src/consts/networks'
import AmbireAccount from "../../contracts/compiled/AmbireAccount.json";

const abiCoder = new ethers.AbiCoder()
const polygonUrl = 'https://rpc.ankr.com/polygon'
const provider = new JsonRpcProvider(polygonUrl)
const SENDER_ADDR = '0x24310b87b02Be1f09c4daD8F54C916911bCD5166'

function getExecuteCalldata(txns: any, sig: string) {
  const abi = ['function execute(tuple(address, uint256, bytes)[] calldata calls, bytes calldata signature) public payable']
  const iface = new ethers.Interface(abi)
  return iface.encodeFunctionData('execute', [txns, sig])
}

async function test() {
  const optimism = networks.find((x) => x.id === 'optimism')
  if (!optimism) throw new Error('unable to find optimism network in consts')
  const provider = new ethers.JsonRpcProvider(optimism.rpcUrl)
  const contract = new ethers.Contract('0x8b1e9b5eBA56e362383B27b460A15323D5e0bb09', AmbireAccount.abi, provider)
  const nonce = await contract.nonce()
  console.log(nonce)
  // const txn = await provider.getTransaction('0x362bf4104d020f92c767ff9efb2565f0ac990d2ce52d58b911d09e7a541d3084')
  // console.log(txn)
}

test()
