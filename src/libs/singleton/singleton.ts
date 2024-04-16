// Special exception for the singleton deployer:
// Estimation on various networks depends entirely on the RPC
// implementation of eth_estimateGas. On ethereum, the RPC tends
// to return ~6kk for our deploy contracts call, which is great as
// the txn will pass (it needs about 4kk).
//
// On polygon though, it returns ~600k, meaning the txn will fail with
// out of gas without any warnings to the user. That's why we need
// to manually up the gasUsed to at least 4500000n,
//
// Then come networks with wild gas estimations above 10m (Arbitrum, Mantle)
// Because of the blob updates, networks fees on this networks have lowered
// dramatically. But no RPC can estimate correctly how much gas is need to
// correctly deploy on the network. That's why we do a multiplication by 5
// and hope for the best.
//
// The backside to this is that txns to the singleton can overestimate.
// Overestimation is now so bad, though. If the real gas is lower, the funds
// will not be taken from the user. Underestimation is worse as txn fails.
export function getGasUsed(gasUsed: bigint): bigint {
  if (gasUsed < 4500000n) return 4500000n

  if (gasUsed > 10000000n) return gasUsed * 5n

  return gasUsed
}
