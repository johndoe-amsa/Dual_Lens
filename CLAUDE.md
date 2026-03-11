# Charte Graphique & Standards UI (Application Web)

## Identité Visuelle (Vercel / Minimalist App Style)
L'esthétique globale est minimaliste, à fort contraste et épurée, optimisée pour des interfaces logicielles (mini-apps, dashboards). L'interface est strictement monochrome avec des bordures extrêmement subtiles, une typographie resserrée et une hiérarchie claire. Support natif des thèmes Light et Dark.

## Principes Fondamentaux du Design
1. **Le contenu est roi :** Utiliser un contraste élevé pour faire de la donnée le point focal principal.
2. **Structure par le vide et la grille :** Utiliser généreusement les espaces blancs basés sur un **système strict de 8px** (8, 16, 24, 32, 48, 64...) et des lignes de 1px. Aucun bloc de couleur lourd.
3. **Typographie "Engineered" :** Garder une typographie serrée en utilisant un espacement négatif des lettres (letter-spacing) sur les titres pour un aspect technique.
4. **Accessibilité et États :** Les états interactifs (Focus, Hover, Active, Disabled) doivent toujours être visuellement évidents.
5. **Élévation sans ombre :** Privilégier le flou d'arrière-plan (`backdrop-blur`) et les bordures pour détacher les éléments flottants (modales, menus) plutôt que de grosses ombres.

## Palette de Couleurs
L'interface repose sur le noir et blanc pur, ajusté pour éviter la fatigue visuelle.
- **Background :** `#FFFFFF` (Light) / `#000000` (Dark) / Secondaire : `#FAFAFA` (Light) ou `#0A0A0A` (Dark).
- **Texte :** `#000000` (Light) / `#EDEDED` (Dark - adouci pour la lecture) / Secondaire : `#666666` (Light) ou `#888888` (Dark).
- **Bordures :** Subtiles `#EAEAEA` (Light) ou `#333333` (Dark) / Fortes (Focus) `#000000` (Light) ou `#FFFFFF` (Dark).
- **Couleurs Sémantiques :** Succès `#0070F3`, Erreur `#EE0000`, Attention `#F5A623`.

## Typographie
Le système typographique est calibré pour une interface d'application (dense mais lisible).
- **Polices :** `Geist, system-ui, -apple-system, sans-serif` (Corps) / `Geist Mono, Menlo, monospace` (Code/Data).
- **Titre Application (H1) :** 36px à 48px, font-weight 700, line-height 1.1, tracking -0.04em.
- **Titre de Section (H2) :** 24px à 32px, font-weight 600, line-height 1.2, tracking -0.03em.
- **Titre de Carte/Module (H3) :** 18px à 20px, font-weight 600, line-height 1.3, tracking -0.02em.
- **Corps de texte :** 16px (Défaut) ou 14px (Small), line-height 1.5, couleur texte secondaire.
- **Label / Surtitre :** 12px, majuscules (uppercase), font-weight 500, tracking 0.05em (espacé), couleur texte secondaire.

## Composants UI

### Boutons
Contraste pur, arrondis en pilule (`rounded-full`), padding `8px 16px` (Small) ou `12px 24px` (Default), font-weight `500`.
- **Primaire :** Fond texte principal / Texte background principal.
- **Secondaire :** Fond transparent / Texte couleur principale / Bordure 1px solid border-subtle.
- **États interactifs (Tous les boutons) :** - *Hover* : Légère variation d'opacité ou de fond.
  - *Active (Clic)* : Effet d'enfoncement (`scale-95` ou `scale-[0.98]`).
  - *Focus-visible* : Anneau de focus net (`ring-2 ring-offset-2 ring-black/white`).
  - *Disabled* : Opacité 50%, curseur `not-allowed`, pas d'effets de hover.

### Formulaires (Inputs, Selects, Textareas)
- **Style par défaut :** Fond transparent ou très légèrement grisé (`#FAFAFA` / `#0A0A0A`), bordure 1px `border-subtle`, radius `6px` ou `8px`.
- **État Focus :** Bordure devient forte (`border-strong`), ajout éventuel d'un anneau de focus (`ring-1 ring-black/white`) pour une accessibilité maximale.

### Bordures, Ombres & Élévation
- **Ombres basiques :** Presque inexistantes. Hover de carte très léger : `0 4px 12px rgba(0, 0, 0, 0.05)`.
- **Bordures :** Lignes grises très fines (`1px solid var(--border-subtle)`).
- **Rayons (Radius) :** Cartes `12px`, Inputs/Boutons carrés `8px`, Badges `6px`, Boutons ronds `9999px`.
- **Élévation (Modales, Dropdowns, Navbars fixes) :** Utiliser un fond semi-transparent couplé à un flou (`backdrop-blur-md bg-white/80` ou `bg-black/80`) et une bordure `border-subtle` pour détacher l'élément du reste de la page.

## Layout & Espacement
- **Règle d'or :** Toujours utiliser des multiples de 8px (ex: `gap-4` = 16px, `p-6` = 24px en Tailwind).
- **Largeur Max App :** `1200px` centré (`margin: 0 auto`) ou pleine largeur (`w-full`) selon le type d'outil.
- **Grille :** 12 colonnes. Espace entre les éléments (Gap) : `16px` ou `24px`.
- **Padding :** Page `24px` ou `32px`, Cartes `24px`.
