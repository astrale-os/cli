import { updateIdentityStore } from '../../identities'

const [action, name, argument] = process.argv.slice(2)

if (action === 'default' && name !== undefined) {
  await updateIdentityStore((current) => {
    if (!current.identities[name]) throw new Error(`Identity "${name}" not found`)
    return { next: { ...current, default: name }, value: undefined }
  })
} else if (action === 'registration' && name !== undefined && argument !== undefined) {
  await updateIdentityStore((current) => {
    const identity = current.identities[name]
    if (!identity) throw new Error(`Identity "${name}" not found`)
    return {
      next: {
        ...current,
        identities: {
          ...current.identities,
          [name]: {
            ...identity,
            registrations: {
              ...identity.registrations,
              [argument]: {
                iss: `https://${argument}.example.test`,
                sub: `${name}-${argument}`,
                registeredAt: '2025-01-01T00:00:00.000Z',
              },
            },
          },
        },
      },
      value: undefined,
    }
  })
} else {
  throw new Error('Invalid identity-transition fixture arguments')
}
