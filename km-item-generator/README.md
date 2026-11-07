# Item-Generator

Foundry-VTT-Modul für Pathfinder 2e (System 8.4, Foundry v14): erstellt Items aus einem einfachen JSON.

## Bedienung

Als GM: Seitenleiste **Items** → Button **Item-Generator**.
Per Makro: `game.modules.get("km-item-generator").api.open()`

1. JSON einfügen oder eine Vorlage laden
2. **Prüfen**: Vorschau mit Fehlern und Warnungen
3. **Erstellen**: Items landen im Ordner „Item-Generator“ (optional auch beim ausgewählten Token)

Ein vom Generator erstelltes Item kann aus der Seitenleiste zurück in das Textfeld gezogen werden, um es zu bearbeiten.
„Format kopieren“ legt eine Beschreibung des Formats in die Zwischenablage, z. B. für eine KI.

## Beispiel: Bogen, der Wurfspeere verschießt

```json
[
  {
    "base": "composite-longbow",
    "name": "Bogen des Hirschkönigs",
    "level": 4,
    "rarity": "unique",
    "reload": "1",
    "ammo": { "type": "javelin", "capacity": 1 },
    "runes": { "potency": 1 },
    "effects": [{ "extraDamage": { "dice": "1d6", "type": "piercing", "scaleWithStriking": true }, "label": "Wurfspeer" }]
  },
  { "base": "javelin", "name": "Wurfspeere (für den Hirschkönig-Bogen)", "quantity": 6, "canBeAmmo": true }
]
```

- Grundlage ist der Kompositlangbogen aus dem PF2e-Kompendium, mit Nachladen 1.
- Munition sind echte Wurfspeere (`canBeAmmo`), die PF2e beim Nachladen in den Bogen lädt und beim Schuss verbraucht.
- Der Zusatzschaden des Wurfspeers wächst mit der Schlagrune: 1d6, 2d6, 3d6, 4d6.

## Beispiel: Hat of Wizardry (Zauber leihen)

Vorlage „Hat of Wizardry“ (englisch, `"lang": "en"`): Stufe 3, +1 auf Arcana, und die Aktion **Borrow Spell** (1/Tag),
die der Träger im Charakterbogen hat, sobald der Hut investiert ist.
„Use“ im Charakterbogen oder im Argon HUD öffnet ein Fenster: Arcana gegen SG 15, bei Erfolg Auswahl eines gewöhnlichen
arkanen Zaubertricks, den der Charakter nicht kennt. Er wird als angeborener arkaner Zauber gewirkt
(eigener Zauber-Eintrag „Borrowed: Hat of Wizardry“).

## Format

Siehe „Format kopieren“ im Fenster oder `scripts/examples.js` (`FORMAT_GUIDE`).

## Installation

Manifest-URL: `https://github.com/<benutzer>/<repo>/releases/latest/download/module.json`

## Neue Version veröffentlichen

Auf GitHub einen Release mit neuem Tag anlegen (z. B. `v0.2.0`). Die GitHub Action setzt Version und Links,
baut die ZIP und hängt sie mit der `module.json` an den Release.
