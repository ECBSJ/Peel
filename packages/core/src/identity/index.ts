export {
  buildIdentityProofMessage,
  hashBitcoinMessage,
  recoverPublicKey,
  buildBridIdentityMap,
} from "./recover.js";
export type { BridIdentityMap } from "./recover.js";
export {
  buildIdentityFromPublicKey,
  recoverPublicKeyFromAddress,
  recoverRecipientIdentity,
} from "./recover-from-chain.js";
export type { RecipientRecoveryOptions } from "./recover-from-chain.js";
