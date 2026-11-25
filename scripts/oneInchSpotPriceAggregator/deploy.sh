#!/usr/bin/env bash
#
# Deploys 1inch's spot price aggregator on a network where 1inch hasn't deployed a working one,
# so that token prices can be read from the network's RPC (see `src/consts/rpcTokenPrices.ts`).
# What gets deployed, and the checks run before anything is sent, are described in
# DeployOneInchSpotPriceAggregator.s.sol.
#
# Needs Foundry (forge), git, node and npm. The contracts are built from a pinned commit of
# https://github.com/1inch/spot-price-aggregator, with the compiler settings 1inch deploys them
# with, in a work directory outside the repo (WORK_DIR). Forge keeps the record of what it
# broadcast there, under broadcast/.
#
# Usage:
#   OWNER=<owner address> ./deploy.sh <network> [forge script options]
#
#   Simulate only, against the live network (sends nothing):
#     OWNER=0x... ./deploy.sh robinhood
#
#   Deploy from the PRIVATE_KEY in ambire-common's .env (the key the Hardhat scripts use), used
#   whenever no wallet option is passed:
#     OWNER=0x... ./deploy.sh robinhood --broadcast --slow
#
#   Or signing with a Ledger:
#     OWNER=0x... ./deploy.sh robinhood --broadcast --slow --ledger --sender <deployer address>
#
#   Or with a Foundry keystore account (`cast wallet import`):
#     OWNER=0x... ./deploy.sh robinhood --broadcast --slow --account <name>
#
# OWNER can add and remove the aggregator's DEX oracles and connector tokens, which changes the
# prices it returns: use a multisig. Networks: robinhood. RPC_URL overrides the network's RPC.

set -euo pipefail

ONEINCH_REPO_URL='https://github.com/1inch/spot-price-aggregator.git'
# master as of 2026-08-21
ONEINCH_COMMIT='436cf57be9ca1357ec5860c99a289fab5c6a9786'
# The version 1inch's package.json pins at that commit
OPENZEPPELIN_VERSION='5.4.0'
SCRIPT_NAME='DeployOneInchSpotPriceAggregator'

network="${1:-}"
if [[ -z "$network" ]]; then
  echo "Usage: OWNER=<owner address> $0 <network> [forge script options]" >&2
  exit 1
fi
shift

case "$network" in
  robinhood) default_rpc_url='https://rpc.mainnet.chain.robinhood.com' ;;
  *)
    echo "No config for network '$network'. Add it here and in $SCRIPT_NAME.s.sol." >&2
    exit 1
    ;;
esac
rpc_url="${RPC_URL:-$default_rpc_url}"

if [[ -z "${OWNER:-}" ]]; then
  echo 'Set OWNER to the address that will own the aggregator (a multisig).' >&2
  exit 1
fi

for tool in forge git node npm; do
  if ! command -v "$tool" >/dev/null; then
    echo "$tool is required but wasn't found." >&2
    exit 1
  fi
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"

# Without a wallet option, deploys from the PRIVATE_KEY in .env, read with dotenv as
# hardhat.config.ts does. The key reaches forge through the environment, never the command line.
uses_wallet_option=false
for arg in "$@"; do
  case "$arg" in
    --ledger | --trezor | --account | --keystore | --keystores | --private-key | --private-keys | \
      --mnemonic | --mnemonics | --interactive | --interactives | --unlocked | --aws | --gcp)
      uses_wallet_option=true
      ;;
  esac
done
if [[ "$uses_wallet_option" == false && -f "$repo_dir/.env" ]]; then
  DEPLOYER_PRIVATE_KEY="$(
    cd "$repo_dir" &&
      node -e "
        require('dotenv').config({ path: '.env', quiet: true })
        const key = process.env.PRIVATE_KEY || ''
        process.stdout.write(key && !key.startsWith('0x') ? '0x' + key : key)
      "
  )"
  if [[ -n "$DEPLOYER_PRIVATE_KEY" ]]; then
    export DEPLOYER_PRIVATE_KEY
    echo 'Deploying from the PRIVATE_KEY in .env'
  fi
fi
work_dir="${WORK_DIR:-$HOME/.cache/ambire/1inch-spot-price-aggregator}"
oneinch_dir="$work_dir/1inch"
deps_dir="$work_dir/deps"

mkdir -p "$work_dir/script"

# The 1inch sources, at exactly the pinned commit
if [[ ! -d "$oneinch_dir/.git" ]]; then
  git init --quiet "$oneinch_dir"
  git -C "$oneinch_dir" remote add origin "$ONEINCH_REPO_URL"
fi
if [[ "$(git -C "$oneinch_dir" rev-parse --verify --quiet HEAD || true)" != "$ONEINCH_COMMIT" ]]; then
  echo "Fetching 1inch/spot-price-aggregator at $ONEINCH_COMMIT"
  git -C "$oneinch_dir" fetch --quiet --depth 1 origin "$ONEINCH_COMMIT"
  git -C "$oneinch_dir" checkout --quiet --detach FETCH_HEAD
fi
actual_commit="$(git -C "$oneinch_dir" rev-parse HEAD)"
if [[ "$actual_commit" != "$ONEINCH_COMMIT" ]]; then
  echo "Expected 1inch at $ONEINCH_COMMIT, found $actual_commit." >&2
  exit 1
fi

# OpenZeppelin is the only dependency of the contracts deployed. Installed without running any
# package scripts.
openzeppelin_package_json="$deps_dir/node_modules/@openzeppelin/contracts/package.json"
installed_openzeppelin_version=''
if [[ -f "$openzeppelin_package_json" ]]; then
  installed_openzeppelin_version="$(node -p "require('$openzeppelin_package_json').version")"
fi
if [[ "$installed_openzeppelin_version" != "$OPENZEPPELIN_VERSION" ]]; then
  echo "Installing @openzeppelin/contracts@$OPENZEPPELIN_VERSION"
  mkdir -p "$deps_dir"
  npm install --prefix "$deps_dir" --ignore-scripts --no-audit --no-fund --no-package-lock \
    --silent "@openzeppelin/contracts@$OPENZEPPELIN_VERSION"
fi

cp "$script_dir/$SCRIPT_NAME.s.sol" "$work_dir/script/"

# The compiler settings of 1inch's hardhat.config.js at the pinned commit
cat >"$work_dir/foundry.toml" <<EOF
[profile.default]
src = "script"
script = "script"
out = "out"
cache_path = "cache"
libs = []
solc_version = "0.8.23"
evm_version = "shanghai"
via_ir = true
optimizer = true
optimizer_runs = 1000000
remappings = [
  "oneinch/=1inch/contracts/",
  "@openzeppelin/contracts/=deps/node_modules/@openzeppelin/contracts/",
]
EOF

echo "Running $SCRIPT_NAME on $network ($rpc_url), owner $OWNER"
cd "$work_dir"
OWNER="$OWNER" forge script "script/$SCRIPT_NAME.s.sol:$SCRIPT_NAME" --rpc-url "$rpc_url" "$@"
