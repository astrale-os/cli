# TODO: Compiler le CLI pour distribution

## Problème actuel

Le CLI utilise `#!/usr/bin/env npx tsx` comme shebang, ce qui :

- Transpile le TypeScript à chaque exécution (lent)
- Déclenche des warnings quand npm lit les `.npmrc` contenant des options pnpm
- Requiert que `tsx` soit disponible via `npx` chez l'utilisateur

## Solution

Distribuer le CLI pré-compilé en JavaScript au lieu de TypeScript.

## Étapes

### 1. Restructurer les fichiers sources

Déplacer `bin/astrale.ts` vers `src/bin/astrale.ts` pour que tout le source soit dans `src/`.

### 2. Configurer tsconfig pour compiler le bin

Dans `tsconfig.json`, s'assurer que `src/bin/` est inclus dans la compilation et que l'output va dans `dist/bin/`.

### 3. Ajouter le shebang au fichier compilé

Deux options :

- **Option A** : Utiliser un plugin esbuild/rollup qui ajoute le shebang
- **Option B** : Script post-build qui ajoute `#!/usr/bin/env node` en haut de `dist/bin/astrale.js`

### 4. Mettre à jour package.json

```json
{
  "bin": {
    "astrale": "./dist/bin/astrale.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc && chmod +x dist/bin/astrale.js",
    "prepublishOnly": "pnpm build"
  }
}
```

### 5. Workflow de dev

Pour le développement local, continuer à utiliser tsx directement :

```json
{
  "scripts": {
    "astrale": "tsx src/bin/astrale.ts"
  }
}
```

Ou simplement `pnpm tsx src/bin/astrale.ts <command>`.

### 6. Tester avant publish

1. `pnpm build`
2. `node dist/bin/astrale.js --version`
3. Vérifier que toutes les commandes fonctionnent

## Points d'attention

- **Imports relatifs** : Vérifier que les chemins d'import fonctionnent après compilation
- **`__dirname`** : Le code utilise `fileURLToPath(import.meta.url)` - ça fonctionne en ESM compilé
- **Permissions** : Le fichier `dist/bin/astrale.js` doit être exécutable (`chmod +x`)
- **Source maps** : Optionnel mais utile pour debug en prod

## Résultat attendu

| Aspect        | Avant                    | Après                   |
| ------------- | ------------------------ | ----------------------- |
| Shebang       | `#!/usr/bin/env npx tsx` | `#!/usr/bin/env node`   |
| Bin path      | `./bin/astrale.ts`       | `./dist/bin/astrale.js` |
| Runtime deps  | tsx via npx              | Aucune (node natif)     |
| Démarrage     | ~500ms (transpile)       | ~50ms                   |
| Warning npmrc | Oui                      | Non                     |
