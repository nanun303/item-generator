/** Vorlagen für das Fenster. Werte sind Beispiele, keine offiziellen Paizo-Daten. */
export const EXAMPLES = {
  staglord: {
    label: "Bogen des Hirschkönigs (verschießt Wurfspeere)",
    data: [
      {
        base: "composite-longbow",
        name: "Bogen des Hirschkönigs",
        level: 4,
        rarity: "unique",
        price: 100,
        reload: "1",
        ammo: { type: "javelin", capacity: 1 },
        runes: { potency: 1 },
        effects: [
          { extraDamage: { dice: "1d6", type: "piercing", scaleWithStriking: true }, label: "Wurfspeer" }
        ],
        description:
          "Ein gewaltiger Kompositbogen, gespannt mit Sehnen aus Hirschdarm. Statt Pfeilen verschießt er Wurfspeere.\n\nDer Bogen muss nach jedem Schuss nachgeladen werden. Ein Treffer verursacht den Schaden des Bogens plus den Schaden des Wurfspeers."
      },
      {
        base: "javelin",
        name: "Wurfspeere (für den Hirschkönig-Bogen)",
        quantity: 6,
        canBeAmmo: true,
        description: "Gewöhnliche Wurfspeere, die sich auch mit dem Bogen des Hirschkönigs verschießen lassen."
      }
    ]
  },
  hat: {
    label: "Hat of Wizardry (Zaubertrick leihen, Stufe 3, englisch)",
    data: {
      lang: "en",
      type: "equipment",
      name: "Hat of Wizardry",
      level: 3,
      price: 60,
      bulk: "-",
      usage: "wornheadwear",
      traits: ["arcane", "invested", "magical"],
      effects: [{ bonus: 1, to: "arcana", type: "item" }],
      activations: [
        {
          name: "Borrow Spell",
          actions: 2,
          traits: ["concentrate", "manipulate"],
          frequency: "once per day",
          asAction: true,
          borrowSpell: { tradition: "arcane", skill: "arcana", dc: 15, rarity: "common" },
          text: "You reach into the brim and grope for a spell you don't know. Attempt a DC 15 Arcana check. On a success, choose a common arcane cantrip you don't know and immediately cast it as an innate arcane spell. On a failure, the magic fizzles. The attempt uses up the hat's daily activation either way."
        }
      ],
      description:
        "This pointed, midnight-blue hat is embroidered with silver stars. The echo of countless spells seems to linger in its brim.\n\nWhile you have it invested, you gain a +1 item bonus to Arcana checks."
    }
  },
  ring: {
    label: "Ring mit Bonus, Resistenz und Aktivierung",
    data: {
      type: "equipment",
      name: "Ring des Wintermorgens",
      level: 6,
      rarity: "uncommon",
      price: 220,
      bulk: "-",
      usage: "worn",
      traits: ["invested", "magical", "cold"],
      effects: [
        { bonus: 1, to: "fortitude", type: "item" },
        { resistance: "cold", value: 5 }
      ],
      activations: [
        {
          name: "Frosthauch",
          actions: 2,
          traits: ["cold", "concentrate"],
          frequency: "einmal pro Tag",
          text: "Du atmest einen Kegel aus Eis (15 Fuß): 4d6 Kälteschaden, einfacher Reflexwurf SG 23."
        }
      ],
      description: "Ein Silberring, auf dem stets ein Hauch Raureif liegt."
    }
  },
  armor: {
    label: "Rüstung mit Runen und Kletterbewegung",
    data: {
      base: "leather-armor",
      name: "Lederwams der Grüngürtler",
      level: 5,
      price: 160,
      runes: { potency: 1 },
      effects: [
        { speed: "climb", value: 15 },
        { bonus: 1, to: "stealth", type: "item" }
      ],
      description: "Weiches Leder in Rinden- und Moosfarben."
    }
  }
};

/** Formatbeschreibung zum Kopieren, z. B. für eine KI, die das JSON erzeugen soll. */
export const FORMAT_GUIDE = `Erzeuge JSON für den Foundry-Modul "Item-Generator" (Pathfinder 2e, System 8.4).
Ein Objekt oder eine Liste von Objekten. Felder (alle optional außer name und base/type):

Allgemein:
- base: Slug eines PF2e-Kompendium-Items als Grundlage, z. B. "longsword", "composite-longbow", "javelin", "leather-armor"
- type: weapon | armor | shield | equipment | consumable | ammo | treasure (nur nötig ohne base)
- name, img, level (Zahl), rarity (common|uncommon|rare|unique)
- traits: komplette Liste (ersetzt), addTraits / removeTraits: ändern die Liste des Grund-Items
- price: 25 oder "12 gp 5 sp" oder {"gp": 12}; bulk: Zahl, "L" oder "-"; quantity; usage (z. B. "worn", "held-in-one-hand")
- description: Text (Leerzeile = neuer Absatz) oder HTML

Waffe:
- damage: "1d8 piercing"; reload: "-", "0", "1", "2"; range: Zahl in Fuß; group; category
- ammo: {"type": "arrow"} oder Grundwaffe als Munition {"type": "javelin", "capacity": 1}
- canBeAmmo: true (diese Waffe kann von einer anderen als Munition verschossen werden)
- runes: {"potency": 0-4, "striking": 0-3, "property": ["flaming", ...]}

Rüstung: acBonus, dexCap, checkPenalty, speedPenalty, strength, runes {"potency", "resilient", "property"}
Schild: acBonus, hardness, hp

effects (werden zu Regelelementen):
- {"bonus": 1, "to": "perception", "type": "item|status|circumstance"}   ("to": ac, fortitude, reflex, will, saving-throw, perception, athletics, skill-check, attack-roll, damage, this-attack, this-damage …)
- {"extraDamage": "1d6 fire"} oder {"extraDamage": {"dice": "1d6", "type": "fire", "scaleWithStriking": true}} oder {"extraDamage": "2 fire"}
- {"resistance": "fire", "value": 5}, {"weakness": "cold", "value": 5}, {"immunity": "poison"}
- {"speed": "climb", "value": 20}, {"sense": "darkvision"}
- {"rule": { ...beliebiges PF2e-Regelelement... }}
- optional bei jedem Effekt: "label", "predicate": ["..."]

activations: [{"name": "...", "actions": 1|2|3|"reaction"|"free", "traits": [...], "frequency": "...", "trigger": "...", "text": "..."}]
- "asAction": true legt die Aktivierung zusätzlich als Aktion an, die der Träger im Charakterbogen hat, solange das Item angelegt ist.
  "frequency" wie "einmal pro Tag" wird dabei ein Zähler, der bei der täglichen Vorbereitung zurückgesetzt wird.
- "borrowSpell": {"tradition": "arcane", "skill": "arcana", "dc": 15, "rarity": "common"} (nur mit "asAction"):
  Beim Benutzen der Aktion öffnet sich ein Fenster: Wurf gegen SG, bei Erfolg Auswahl eines Zaubertricks der Tradition,
  den der Charakter nicht kennt, gewirkt als angeborener Zauber.

lang: "de" (Standard) oder "en" – Sprache der Überschriften, die der Generator selbst schreibt (Activate, Frequency, Effect …)
system: { ... } setzt beliebige Systemfelder direkt (für Sonderfälle)

Hinweis: Getragene magische Items brauchen den Trait "invested", damit ihre Effekte wirken.`;
