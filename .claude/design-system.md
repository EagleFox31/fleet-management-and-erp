# Design System — Yaro FleetOS

Guide de référence pour la refonte des pages et composants.
Stack : React 18 + Tailwind CSS + Radix UI + lucide-react.

---

## Thème couleurs

| Rôle            | Valeur hex  | Usage                                      |
|-----------------|-------------|--------------------------------------------|
| Primaire        | `#16a34a`   | Boutons principaux, accents, highlights     |
| Primaire foncé  | `#15803d`   | Gradient boutons (côté droit)              |
| Primaire clair  | `#4ade80`   | Accents sur fond sombre                    |
| Fond hero clair | `#f0fdf4 → #dcfce7 → #bbf7d0` | Banner / hero header light |
| Fond hero sombre| `#0b2116 → #071610 → #040d08` | Banner / hero header dark (éviter — trop sombre sur fond blanc app) |
| Bordure verte   | `#86efac`   | Bordure des cards / hero clair             |
| Bleu info       | `#eff6ff` / `#bfdbfe` | Sections informationnelles           |
| Ambre avertissement | `#fffbeb` / `#fde68a` | Notes, alertes modérées          |
| Violet          | `#faf5ff` / `#e9d5ff` | Notes fournisseur, codes livraison   |
| Rouge danger    | `#fef2f2` / `#fecaca` | Erreurs, annulations                 |

---

## Patterns de mise en page

### Hero header (bannière de page)

```tsx
<div
  className="rounded-2xl relative overflow-hidden"
  style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 60%, #bbf7d0 100%)", border: "1px solid #86efac" }}
>
  {/* Dot grid texture */}
  <div className="absolute inset-0 pointer-events-none"
    style={{ backgroundImage: "radial-gradient(rgba(22,163,74,0.12) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

  <div className="relative z-10 px-6 pt-6 pb-5">
    <p className="text-[10px] font-bold tracking-widest uppercase text-green-600 mb-0.5">Sous-titre module</p>
    <h1 className="text-green-900 font-black text-2xl tracking-tight leading-none">Titre principal</h1>
    <p className="text-green-700/60 text-[12px] mt-1">Description courte</p>

    {/* KPIs rapides */}
    <div className="mt-5 grid grid-cols-3 gap-3">
      {/* Tuile KPI */}
      <div className="rounded-xl px-4 py-3"
        style={{ background: "rgba(255,255,255,0.55)", border: "1px solid rgba(22,163,74,0.20)" }}>
        <p className="text-green-600/70 text-[10px] font-semibold tracking-wide uppercase mb-1">Label</p>
        <p className="font-bold text-[15px] text-green-900">Valeur</p>
      </div>
    </div>
  </div>
</div>
```

### Tuile info (label + valeur)

```tsx
<div className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
  <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-0.5">Label</p>
  <p className="text-sm font-semibold text-gray-800">Valeur</p>
</div>
```

### Tuile colorée contextuelle

| Contexte           | Background | Bordure    | Texte label     |
|--------------------|------------|------------|-----------------|
| Neutre             | `#f8fafc`  | `#e2e8f0`  | `text-gray-400` |
| Info (bleu)        | `#eff6ff`  | `#bfdbfe`  | `text-blue-500` |
| Succès / Dates OK  | `#f0fdf4`  | `#bbf7d0`  | `text-green-600`|
| Avertissement      | `#fffbeb`  | `#fde68a`  | `text-amber-600`|
| Fournisseur/violet | `#faf5ff`  | `#e9d5ff`  | `text-purple-500`|
| Danger/erreur      | `#fef2f2`  | `#fecaca`  | `text-red-500`  |

### Card avec accent coloré en tête

```tsx
<Card className="border-0 shadow-sm overflow-hidden">
  <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, #16a34a, #4ade80)" }} />
  <CardHeader>...</CardHeader>
  <CardContent>...</CardContent>
</Card>
```

### Icon header de section

```tsx
<div className="flex items-center gap-2">
  <div className="w-7 h-7 rounded-lg flex items-center justify-center"
    style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
    <IconName className="w-3.5 h-3.5 text-green-600" />
  </div>
  <CardTitle className="text-base">Titre de section</CardTitle>
</div>
```

---

## Badges de statut

Toujours utiliser `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border`.

| Statut              | Classes Tailwind                                  |
|---------------------|---------------------------------------------------|
| Brouillon / À faire | `bg-gray-100 text-gray-700 border-gray-200`       |
| Envoyé / En cours   | `bg-blue-50 text-blue-700 border-blue-200`        |
| Confirmé / Validé   | `bg-green-50 text-green-700 border-green-200`     |
| Partiel / Attention | `bg-amber-50 text-amber-700 border-amber-200`     |
| Livré               | `bg-indigo-50 text-indigo-700 border-indigo-200`  |
| Clôturé             | `bg-emerald-50 text-emerald-700 border-emerald-200`|
| Annulé / Erreur     | `bg-red-50 text-red-700 border-red-200`           |

---

## Boutons

```tsx
{/* Primaire */}
<Button className="text-white font-semibold shadow-sm"
  style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
  Action principale
</Button>

{/* Danger */}
<Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50">
  Annuler
</Button>

{/* Neutre retour */}
<button className="flex items-center gap-1.5 text-[12px] font-medium text-gray-400 hover:text-gray-600 transition-colors">
  <ArrowLeft className="w-3.5 h-3.5" /> Retour
</button>
```

---

## Typographie

| Rôle                   | Classes                                                 |
|------------------------|---------------------------------------------------------|
| Titre page             | `font-black text-2xl tracking-tight text-green-900`     |
| Sous-titre module      | `text-[10px] font-bold tracking-widest uppercase text-green-600` |
| Label de tuile         | `text-[10px] font-bold tracking-widest uppercase text-gray-400` |
| Valeur principale      | `text-sm font-semibold text-gray-800`                   |
| Valeur highlight vert  | `font-bold text-[15px] text-green-700`                  |
| Texte secondaire       | `text-[11px] text-gray-400`                             |
| Référence / code       | `text-[11px] font-mono text-gray-400`                   |

---

## Modales / Dialogs

- `p-0 overflow-hidden gap-0` sur `DialogContent` pour contrôler le padding manuellement
- Mini hero header en haut (fond vert clair) + corps scrollable avec `max-h-[60vh] overflow-y-auto`
- Pas de `DialogHeader` standard — intégrer titre dans le hero

```tsx
<DialogContent className="sm:max-w-[580px] p-0 overflow-hidden gap-0">
  {/* Mini hero */}
  <div className="px-5 pt-5 pb-4" style={{ background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", borderBottom: "1px solid #86efac" }}>
    <p className="text-[10px] font-bold tracking-widest uppercase text-green-600 mb-1">Module</p>
    <h2 className="font-black text-green-900 text-lg">Titre</h2>
  </div>
  {/* Corps */}
  <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
    ...
  </div>
</DialogContent>
```

---

## Stepper de workflow

Cercles numérotés colorés : vert = complété, couleur accent = étape courante, gris = futur.

```tsx
<span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
  style={
    isCompleted ? { background: "#16a34a", color: "white" } :
    isCurrent   ? { background: accentColor, color: "white" } :
                  { background: "#e5e7eb", color: "#9ca3af" }
  }>
  {isCompleted ? "✓" : stepNumber}
</span>
```

---

## Timeline de process (relais multi-profils)

**À venir** — cadrage : `docs/planning/EVOLUTION_PROCESS_TIMELINE.md`.  
Inspiré d’atelier2026 (`OTTimeline`) : colonne verticale, pas le stepper de création.

À utiliser sur les objets suivis par **plusieurs rôles** (demande de pièce, commande, OT, mission). Ne pas confondre avec la timeline d’historique ci-dessous (journal, pas un relais).

Chaque étape affiche :

1. État visuel : fait / actuel / futur (check, anneau, cercle vide).
2. Libellé de **l’objet** (constantes partagées), pas l’action.
3. **Profil attendu** (Magasinier, Chef d’atelier…).
4. Si l’étape est faite : **personne réelle + date**.
5. Badge « À faire » seulement si le rôle connecté est l’acteur attendu.

Le stepper horizontal (`workflow/stepper.tsx`) reste réservé aux wizards de création.

---

## Timeline d'historique

Chaque entrée = fond + bordure colorés selon le statut cible, avec icône ronde à gauche.

```tsx
<div className="flex items-start gap-3 rounded-xl p-3"
  style={{ background: statusBg, border: `1px solid ${statusBorder}` }}>
  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
    style={{ background: accentColor + "20", border: `1.5px solid ${statusBorder}` }}>
    <StatusIcon className="w-3.5 h-3.5" style={{ color: accentColor }} />
  </div>
  <div>
    <p className="text-[12px] font-semibold text-gray-800">De → Vers</p>
    <p className="text-[11px] text-gray-500">Date · Acteur</p>
  </div>
</div>
```

---

## Règles générales

1. **Pas de `border` Tailwind par défaut** sur les cards — utiliser `border-0 shadow-sm` + bordure inline style pour contrôle précis.
2. **Fond des tuiles neutres** : `#f8fafc` / `#e2e8f0` (jamais du gris Tailwind brut).
3. **Aucun emoji** — jamais, nulle part. Toujours utiliser une icône lucide-react à la place.
4. **Icônes dans les labels de tuiles** : `<IconName className="w-3 h-3 text-[couleur]" />` inline avant le texte dans un `flex items-center gap-1`.
5. **Arrondis** : `rounded-xl` (tuiles), `rounded-2xl` (heroes/cards larges), `rounded-lg` (petits éléments).
6. **Espacements section** : `space-y-5` entre les cards d'une page, `space-y-4` à l'intérieur d'une card.
7. **Tables** : header `bg-gray-50 hover:bg-gray-50`, texte header `text-[11px] font-bold uppercase tracking-wide text-gray-500`, padding `pl-6` première colonne.

### Pattern label avec icône (tuile)

```tsx
<div className="flex items-center gap-1 mb-0.5">
  <IconName className="w-3 h-3 text-gray-400" />
  <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400">Label</p>
</div>
```

## Couleurs : jetons, pas palette

- Texte et surfaces passent par les jetons (`text-foreground`, `text-muted-foreground`, `text-primary-text`, `text-destructive-text`, `bg-card`, `bg-background`...), pas par la palette Tailwind (`text-red-600`, `bg-green-50`) ni par `bg-white` / `text-black`. Le contraste des jetons est verifie (`scripts/contrast-semantic-text.mjs`).
- Cliquet : `tests/unit/client/no-tailwind-palette-in-ui.test.ts` fige le compte par fichier ; un compte baisse impose d'abaisser la liste dans le meme commit.
- Mode sombre : **non supporte**. Il n'y a ni `ThemeProvider` ni bascule ; la classe `dark` n'est jamais posee. Les variantes `dark:` existantes sont inertes et `CardShell` pose `bg-white`. Passer aux jetons prepare un mode sombre sans le promettre ; l'activer est une decision produit.
