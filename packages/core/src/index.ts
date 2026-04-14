// Address derivation from a secp256k1 compressed public key
export { deriveBitcoinAddress, deriveStacksAddress, deriveEvmAddress } from "./address/index.js";

// Public key recovery via Bitcoin message signing (BRID Identity Proof)
export {
  buildIdentityProofMessage,
  hashBitcoinMessage,
  recoverPublicKey,
  buildBridIdentityMap,
} from "./identity/index.js";
export type { BridIdentityMap } from "./identity/index.js";

// Chain + asset registry
export {
  NETWORKS,
  getNetwork,
  getMainnetNetworks,
  getTestnetNetworks,
  ASSETS,
  getAssetsForNetwork,
  getBridgedBtcAssets,
  getAsset,
} from "./registry/index.js";
