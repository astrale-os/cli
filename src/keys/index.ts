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
export { signAs } from './credential'
export type { Keypair, KeypairInput, KeypairPaths } from './pair'
