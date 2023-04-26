const { ethers } = require("ethers")
const { wallet } = require("./config")
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

module.exports = {
  sendFunds,
  getPriviledgeTxn
}