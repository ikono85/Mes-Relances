# Mes Relances

Application de bureau (Electron) pour le suivi de recherche d'emploi : relances
d'agences d'intérim et d'entreprises, entretiens, missions, paie, formations et
documents.

Version : **3.1.0**

## Fonctionnalités

- **Relances** — qui relancer aujourd'hui, messages email / SMS / appel prêts à l'envoi.
- **À démarcher** — carnet d'entreprises à contacter, import depuis Excel (CSV `;`).
- **Entretiens** — rappel la veille et le jour même, message de remerciement.
- **Missions d'intérim** — rappel 3 jours avant la fin pour prévenir l'agence.
- **Paie** — heures oubliées, indemnité de fin de mission, congés payés.
- **Formations** — CACES, soudure, permis : rappel 2 mois avant le recyclage.
- **Documents** — CV, lettres, diplômes, classés en catégories et sous-catégories.
- **Statistiques** et bilan France Travail (PDF ou Excel).
- Thème clair ou sombre, sauvegarde automatique vers une clé USB ou un disque externe.

## Lancer en développement

```bash
npm install
npm start
```

## Construire l'exécutable Windows

```bash
npm run package
```

Le résultat se trouve dans `out/Mes Relances-win32-x64/`.

## Structure

| Fichier | Rôle |
| --- | --- |
| `main.js` | processus principal Electron : fenêtre, notifications, accès disque, sauvegardes |
| `preload.js` | pont `contextBridge` entre le processus principal et l'interface |
| `index.html` | toute l'interface et la logique applicative |
| `splash.html` | écran de démarrage |
| `fonts/` | polices embarquées (Bricolage Grotesque, Figtree, IBM Plex Mono) |
| `icon.ico`, `icon.png` | icônes de l'application |

Aucune dépendance runtime : l'application n'utilise qu'Electron et les modules
Node intégrés (`fs`, `path`).

## Licence

MIT
