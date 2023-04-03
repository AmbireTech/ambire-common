# High-level overview

## Libraries

### deployless.ts
Deployess is a library that allows us to perform off-chain calls through `eth_call` to contracts that are not deployed.

This lets us practically execute any arbitrary code off-chain and get the result without having to pre-deploy contracts. This is used by libraries like `portfolio`, or to do any complex batch operation that would otherwise require numerious `eth_call`s.

It achieves this through two methods: either a magic proxy contract, or the [state override set](https://chainstack.com/deep-dive-into-eth_call/).

Let's look into both of them:
* [magic proxy contract](https://github.com/AmbireTech/relayer/blob/93346dcdc1b51837a377cd3ce5ba34b75e2f7182/src/velcro-v3/contracts/Deployless.sol): this is a contract that, upon it's deployment, deploys another contract and calls it, and returns the result; normally, Solidity doesn't allow contracts to return data from the constructor, but we hack this via assembly; this method is supported by every RPC node but it's limited to [24kb of input](https://eips.ethereum.org/EIPS/eip-170); this restriction [may](https://ethereum-magicians.org/t/removing-or-increasing-the-contract-size-limit/3045/23) [be](https://github.com/ethereum/EIPs/issues/1662) lifted
* [state override set](https://github.com/ethereum/go-ethereum/issues/19836): this is a little known feature of `eth_call` that lets us pass any state overrides that will be applied before executing the call, like overriding an address' balance, contract code, or even parts of it's state; it is not supported by all RPC nodes

The library can auto-select which one to chose based on the availability of the state override set.
