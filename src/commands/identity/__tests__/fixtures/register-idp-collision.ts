import { createIdentity, upsertIdpIdentity } from '../../../../identity/index'

await createIdentity('local-owner', { subject: 'shared-subject' })
await upsertIdpIdentity('workos-user', {
  subject: 'shared-subject',
  idp: 'workos',
  issuer: 'https://idp.example',
})
