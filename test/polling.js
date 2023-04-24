// For the tests, we are using hardhat's local node.
// When running the tests, we face concurency issues sometimes
// as contracts that have been deployed once are read from the cache
// (dynamically chaning constructor arguments) and redeployed extremely fast.
// While that is convinient, the wallet nonce sometimes
// falls behind and when we try to execute the next txn in line,
// a "nonce already used" error pops up.
// To counter it, we wait:
// * for a contract deployment, if we are deploying a contract
// * for a txn mine, if we are sending a txn
// Afterwards, we need to check whether the mempool has been cleared
// and our wallet's nonce has caught up.
// We do so by caching the last nonce sent by the wallet

const { provider } = require("./config")

let lastNonce = {}
async function wait(wallet, waitable = null) {
  if (waitable) await waitWaitable(waitable)
  
  const finished = await provider.getTransactionCount(wallet.address)
  const pending = await provider.getTransactionCount(wallet.address, 'pending')
  const hasCachedNonce = wallet in lastNonce
  if (
    finished == pending &&
    (!hasCachedNonce || lastNonce[wallet] < finished)
    
  ) {
    lastNonce[wallet] = finished
    return
  }
  await new Promise(r => setTimeout(r, 500)); //sleep
  return await wait(wallet)
}

async function waitWaitable(waitable) {
  if ('wait' in waitable) {
    await waitable.wait()
  }
  if ('waitForDeployment' in waitable) {
    await waitable.waitForDeployment()
  }
}

module.exports = {wait}