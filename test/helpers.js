const { ethers } = require("ethers")
const { wallet, addressOne, addressTwo, abiCoder } = require("./config")
const { wait } = require("./polling")

async function sendFunds(to, ether) {
  const txn = await wallet.sendTransaction({
    to: to,
    value: ethers.parseEther(ether.toString()),
  })
  await wait(wallet, txn)
}

function getPriviledgeTxn(ambireAccountAddr, privAddress, hasPriv = true) {
  const setAddrPrivilegeABI = [
    'function setAddrPrivilege(address addr, bytes32 priv)'
  ]
  const iface = new ethers.Interface(setAddrPrivilegeABI)
  const priv = hasPriv ? 1 : 0
  const calldata = iface.encodeFunctionData('setAddrPrivilege', [ privAddress, ethers.toBeHex(priv, 32) ])
  return [ambireAccountAddr, 0, calldata]
}

const timelock = 1 // a 1 second timelock default
const defaultRecoveryInfo = [[addressOne, addressTwo], timelock]
function getTimelockData(recoveryInfo = defaultRecoveryInfo) {
  const hash = ethers.keccak256(abiCoder.encode(['tuple(address[], uint)'], [recoveryInfo]))
  const timelockAddress = '0x' + hash.slice(hash.length - 40, hash.length)
  return {hash, timelockAddress}
}

module.exports = {
  sendFunds,
  getPriviledgeTxn,
  getTimelockData
}