export {
  acceptKeypair,
  fileExists,
  generateEd25519Jwk,
  importKeypair,
  keypairPaths,
  listIdentityKeys,
  persistKeypair,
  readKeypair,
  removeKeypair,
} from './pair'
export { loadAuth, persistAuth, resolveAuth, signAs } from './credential'
export type { Keypair, KeypairInput, KeypairPaths } from './pair'
export type { AuthBinding } from './credential'
