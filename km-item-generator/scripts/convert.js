/**
 * Wandelt das vereinfachte JSON in PF2e-Item-Daten um.
 * Ohne direkten Foundry-Zugriff: Kompendium-Suche und PF2e-Konfiguration kommen über `ctx`,
 * damit sich die Umwandlung auch außerhalb von Foundry testen lässt.
 *
 * ctx = {
 *   findBase(ref): Promise<{ source, uuid } | null>,   // Grund-Item aus dem Kompendium
 *   config: CONFIG.PF2E                                 // zur Prüfung von Traits, Schadensarten, Runen
 * }
 */

export const MODULE_ID = "km-item-generator";

const ITEM_TYPES = ["weapon", "armor", "shield", "equipment", "consumable", "ammo", "treasure", "backpack"];
const DIE_SIZES = ["d4", "d6", "d8", "d10", "d12"];
const RELOAD = ["-", "0", "1", "2", "3", "10"];
const STRIKING = { striking: 1, greater: 2, "greater-striking": 2, greaterStriking: 2, major: 3, "major-striking": 3, majorStriking: 3 };
const RESILIENT = { resilient: 1, greater: 2, "greater-resilient": 2, major: 3, "major-resilient": 3 };
const ACTION_GLYPHS = { 1: "1", 2: "2", 3: "3", reaction: "R", free: "F", "1-2": "1 or 2", "1-3": "1 to 3", "2-3": "2 or 3" };

/** Kurzformen für häufige Selektoren. "this-attack"/"this-damage" meinen die Angriffe dieser Waffe. */
const SELECTOR_ALIASES = {
  "this-attack": "{item|_id}-attack",
  "this-damage": "{item|_id}-damage",
  attack: "attack-roll",
  attacks: "attack-roll",
  saves: "saving-throw",
  skills: "skill-check"
};

/** Erlaubte Felder pro Eintrag, damit Tippfehler als Warnung auffallen. */
const KNOWN_KEYS = new Set([
  "type", "base", "name", "img", "level", "rarity", "traits", "addTraits", "removeTraits", "price", "bulk", "quantity",
  "usage", "description", "activations", "effects", "rules", "system", "folder",
  // Waffe
  "damage", "reload", "range", "ammo", "canBeAmmo", "group", "category", "runes",
  // Rüstung
  "acBonus", "dexCap", "checkPenalty", "speedPenalty", "strength",
  // Schild
  "hardness", "hp"
]);

/* -------------------------------------------- */
/*  Einstieg                                    */
/* -------------------------------------------- */

/**
 * @param {string|object|object[]} input  JSON-Text, ein Eintrag oder eine Liste
 * @returns {Promise<{items: object[], errors: string[], warnings: string[]}>}
 */
export async function buildItems(input, ctx) {
  const errors = [];
  const warnings = [];
  let entries;
  try {
    entries = typeof input === "string" ? JSON.parse(input) : input;
  } catch (err) {
    return { items: [], errors: [`JSON ist ungültig: ${err.message}`], warnings };
  }
  if (entries && !Array.isArray(entries) && Array.isArray(entries.items)) entries = entries.items;
  if (!Array.isArray(entries)) entries = [entries];

  const items = [];
  for (const [i, entry] of entries.entries()) {
    const label = entry?.name ? `„${entry.name}“` : `Eintrag ${i + 1}`;
    const log = { error: (m) => errors.push(`${label}: ${m}`), warn: (m) => warnings.push(`${label}: ${m}`) };
    try {
      const item = await buildItem(entry, ctx, log);
      if (item) items.push(item);
    } catch (err) {
      log.error(err.message);
    }
  }

  // Waffe als Munition: Hinweis, falls keine passende Munition mitgeliefert wird
  const baseWeapons = ctx.config?.baseWeaponTypes ?? {};
  for (const item of items) {
    const ammoType = item.type === "weapon" ? item.system.ammo?.baseType : null;
    if (!ammoType || !(ammoType in baseWeapons)) continue;
    const supplied = items.some((i) => i.type === "weapon" && i.system.baseItem === ammoType && i.system.usage?.canBeAmmo);
    if (!supplied) {
      warnings.push(`„${item.name}“: Munition sind „${ammoType}“-Waffen mit "canBeAmmo": true. Gewöhnliche Exemplare werden nicht geladen, also passende Munition mit erstellen.`);
    }
  }
  return { items, errors, warnings };
}

async function buildItem(entry, ctx, log) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    log.error("muss ein Objekt { … } sein.");
    return null;
  }
  for (const key of Object.keys(entry)) if (!KNOWN_KEYS.has(key)) log.warn(`unbekanntes Feld „${key}“ wird ignoriert.`);

  // Grundlage: Kompendium-Item oder leeres Item
  let item;
  if (entry.base) {
    const found = await ctx.findBase(entry.base);
    if (!found) {
      log.error(`Grund-Item „${entry.base}“ nicht im PF2e-Kompendium gefunden (Slug wie "composite-longbow" oder englischer Name).`);
      return null;
    }
    item = structuredClone(found.source);
    for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) delete item[key];
    item._stats = { compendiumSource: found.uuid };
    if (entry.type && entry.type !== item.type) log.warn(`„type“ (${entry.type}) passt nicht zum Grund-Item (${item.type}), nehme ${item.type}.`);
  } else {
    if (!ITEM_TYPES.includes(entry.type)) {
      log.error(`ohne „base“ wird „type“ gebraucht: ${ITEM_TYPES.join(", ")}.`);
      return null;
    }
    item = { type: entry.type, system: {} };
  }
  if (!entry.name) {
    log.error("„name“ fehlt.");
    return null;
  }
  const sys = item.system;
  const cfg = ctx.config ?? {};

  item.name = String(entry.name);
  if (entry.img) item.img = entry.img;
  if (entry.level !== undefined) sys.level = { value: toInt(entry.level, "level", log) };
  if (entry.quantity !== undefined) sys.quantity = toInt(entry.quantity, "quantity", log);
  if (entry.usage) sys.usage = { ...(sys.usage ?? {}), value: entry.usage };
  if (entry.price !== undefined) sys.price = { ...(sys.price ?? {}), value: parsePrice(entry.price, log) };
  if (entry.bulk !== undefined) sys.bulk = { value: parseBulk(entry.bulk, log) };

  applyTraits(item, entry, cfg, log);
  if (item.type === "weapon") applyWeapon(item, entry, cfg, log);
  if (item.type === "armor") applyArmor(item, entry, cfg, log);
  if (item.type === "shield") applyShield(item, entry, log);
  if (entry.runes && !["weapon", "armor"].includes(item.type)) log.warn("„runes“ gibt es nur bei Waffen und Rüstungen.");

  // Regelelemente
  const rules = [];
  for (const eff of asArray(entry.effects)) {
    const rule = effectToRule(eff, item, cfg, log);
    if (rule) rules.push(rule);
  }
  for (const raw of asArray(entry.rules)) {
    if (raw && typeof raw === "object" && raw.key) rules.push(structuredClone(raw));
    else log.warn("Eintrag in „rules“ ohne „key“ wird ignoriert.");
  }
  if (rules.length) sys.rules = [...(entry.base ? (sys.rules ?? []) : []), ...rules];

  // Beschreibung und Aktivierungen
  const description = buildDescription(entry, log);
  if (description !== null) sys.description = { ...(sys.description ?? {}), value: description };

  // Aktivierungen mit "asAction" werden eigene Aktionen, die das Item seinem Träger gewährt.
  // Sie werden beim Erstellen angelegt und per GrantItem verknüpft (siehe foundry.js), daher nur vorgemerkt.
  const grants = asArray(entry.activations).filter((a) => a?.asAction).map((a) => buildAction(a, entry, log));
  if (grants.length) item._grants = grants;

  // Notausgang: beliebige Systemfelder direkt setzen
  if (entry.system && typeof entry.system === "object") deepMerge(sys, entry.system);

  item.flags = { ...(item.flags ?? {}), [MODULE_ID]: { input: structuredClone(entry) } };
  return item;
}

/* -------------------------------------------- */
/*  Allgemeine Felder                           */
/* -------------------------------------------- */

function applyTraits(item, entry, cfg, log) {
  const sys = item.system;
  sys.traits = { value: [], rarity: "common", ...(sys.traits ?? {}) };
  sys.traits.value = [...(sys.traits.value ?? [])];
  if (entry.rarity) {
    if (cfg.rarityTraits && !(entry.rarity in cfg.rarityTraits)) log.warn(`Seltenheit „${entry.rarity}“ unbekannt (common, uncommon, rare, unique).`);
    sys.traits.rarity = entry.rarity;
  }
  if (entry.traits) sys.traits.value = asArray(entry.traits).map(String);
  for (const t of asArray(entry.addTraits)) if (!sys.traits.value.includes(t)) sys.traits.value.push(String(t));
  const remove = new Set(asArray(entry.removeTraits));
  sys.traits.value = sys.traits.value.filter((t) => !remove.has(t));

  const known = {
    weapon: cfg.weaponTraits, armor: cfg.armorTraits, shield: cfg.shieldTraits, equipment: cfg.equipmentTraits,
    consumable: cfg.consumableTraits, ammo: cfg.consumableTraits
  }[item.type];
  if (known) {
    for (const t of sys.traits.value) if (!(t in known)) log.warn(`Trait „${t}“ ist für ${item.type} unbekannt.`);
  }
}

function applyWeapon(item, entry, cfg, log) {
  const sys = item.system;
  if (entry.damage !== undefined) {
    const dmg = parseDamage(entry.damage, cfg, log);
    if (dmg) sys.damage = { modifier: 0, persistent: null, ...(sys.damage ?? {}), dice: dmg.dice, die: dmg.die, damageType: dmg.type };
  }
  if (entry.reload !== undefined) {
    const r = String(entry.reload);
    if (!RELOAD.includes(r)) log.warn(`„reload“ ${r} ist kein gültiger Wert (${RELOAD.join(", ")}).`);
    sys.reload = { value: r };
  }
  if (entry.range !== undefined) sys.range = entry.range === null ? null : toInt(entry.range, "range", log);
  if (entry.group) sys.group = entry.group;
  if (entry.category) sys.category = entry.category;
  if (entry.ammo !== undefined) {
    if (entry.ammo === null) sys.ammo = null;
    else {
      const a = typeof entry.ammo === "string" ? { type: entry.ammo } : entry.ammo;
      const isAmmoType = cfg.ammoTypes && a.type in cfg.ammoTypes;
      const isWeaponType = cfg.baseWeaponTypes && a.type in cfg.baseWeaponTypes;
      if (cfg.ammoTypes && !isAmmoType && !isWeaponType) log.warn(`Munitionsart „${a.type}“ unbekannt (Munitionsart oder Grundwaffe wie "javelin").`);
      sys.ammo = { builtIn: false, baseType: a.type ?? null, capacity: a.capacity ?? 1 };
    }
  }
  if (entry.canBeAmmo !== undefined) sys.usage = { ...(sys.usage ?? { value: "held-in-one-hand" }), canBeAmmo: !!entry.canBeAmmo };
  if (entry.runes) {
    const r = entry.runes;
    const runes = { potency: 0, striking: 0, property: [], ...(sys.runes ?? {}) };
    if (r.potency !== undefined) runes.potency = clampInt(r.potency, 0, 4, "runes.potency", log);
    if (r.striking !== undefined) runes.striking = parseRuneLevel(r.striking, STRIKING, "runes.striking", log);
    if (r.property) {
      runes.property = asArray(r.property);
      for (const p of runes.property) if (cfg.weaponPropertyRunes && !(p in cfg.weaponPropertyRunes)) log.warn(`Eigenschaftsrune „${p}“ unbekannt.`);
    }
    sys.runes = runes;
  }
}

function applyArmor(item, entry, cfg, log) {
  const sys = item.system;
  for (const key of ["acBonus", "dexCap", "checkPenalty", "speedPenalty", "strength"]) {
    if (entry[key] !== undefined) sys[key] = entry[key] === null ? null : toInt(entry[key], key, log);
  }
  if (entry.runes) {
    const r = entry.runes;
    const runes = { potency: 0, resilient: 0, property: [], ...(sys.runes ?? {}) };
    if (r.potency !== undefined) runes.potency = clampInt(r.potency, 0, 4, "runes.potency", log);
    if (r.resilient !== undefined) runes.resilient = parseRuneLevel(r.resilient, RESILIENT, "runes.resilient", log);
    if (r.property) {
      runes.property = asArray(r.property);
      for (const p of runes.property) if (cfg.armorPropertyRunes && !(p in cfg.armorPropertyRunes)) log.warn(`Rüstungsrune „${p}“ unbekannt.`);
    }
    sys.runes = runes;
  }
}

function applyShield(item, entry, log) {
  const sys = item.system;
  if (entry.acBonus !== undefined) sys.acBonus = toInt(entry.acBonus, "acBonus", log);
  if (entry.hardness !== undefined) sys.hardness = toInt(entry.hardness, "hardness", log);
  if (entry.hp !== undefined) {
    const max = typeof entry.hp === "object" ? toInt(entry.hp.max, "hp.max", log) : toInt(entry.hp, "hp", log);
    sys.hp = { ...(sys.hp ?? {}), max, value: max };
  }
}

/* -------------------------------------------- */
/*  Effekte → Regelelemente                     */
/* -------------------------------------------- */

function selectorOf(value, fallback) {
  const list = asArray(value ?? fallback).map((s) => SELECTOR_ALIASES[s] ?? s);
  return list.length === 1 ? list[0] : list;
}

function common(eff, rule) {
  if (eff.label) rule.label = eff.label;
  if (eff.predicate) rule.predicate = asArray(eff.predicate);
  return rule;
}

function effectToRule(eff, item, cfg, log) {
  if (!eff || typeof eff !== "object") {
    log.warn("Effekt ist kein Objekt und wird ignoriert.");
    return null;
  }
  const checkDamageType = (t) => {
    if (t && cfg.damageTypes && !(t in cfg.damageTypes)) log.warn(`Schadensart „${t}“ unbekannt.`);
  };

  // Bonus/Malus: { "bonus": 1, "to": "perception", "type": "item" }
  if (eff.bonus !== undefined) {
    if (!eff.to) log.warn("Bonus ohne „to“ (z. B. \"perception\", \"ac\", \"athletics\").");
    return common(eff, { key: "FlatModifier", selector: selectorOf(eff.to, "perception"), value: eff.bonus, type: eff.type ?? "item" });
  }

  // Zusatzschaden: { "extraDamage": { "dice": "1d6", "type": "fire", "scaleWithStriking": true } } oder "1d6 fire" oder "2 fire"
  if (eff.extraDamage !== undefined) {
    const d = typeof eff.extraDamage === "string" ? parseDamageString(eff.extraDamage) : eff.extraDamage;
    if (!d) {
      log.warn(`Zusatzschaden „${JSON.stringify(eff.extraDamage)}“ nicht lesbar (z. B. "1d6 fire").`);
      return null;
    }
    const selector = selectorOf(eff.to, item.type === "weapon" ? "this-damage" : "strike-damage");
    const type = d.type ?? d.damageType ?? null;
    checkDamageType(type);
    const dice = typeof d.dice === "string" ? parseDice(d.dice) : { count: d.count ?? 1, die: d.die };
    if (dice?.die) {
      if (!DIE_SIZES.includes(dice.die)) log.warn(`Würfel „${dice.die}“ ungültig (${DIE_SIZES.join(", ")}).`);
      // Mit der Schlagrune wachsen: Würfelzahl = Würfelzahl der Waffe (1 + Schlagrune)
      const diceNumber = d.scaleWithStriking
        ? dice.count === 1 ? "@item.system.damage.dice" : `${dice.count}*@item.system.damage.dice`
        : dice.count;
      if (d.scaleWithStriking && item.type !== "weapon") log.warn("„scaleWithStriking“ wirkt nur bei Waffen.");
      return common(eff, { key: "DamageDice", selector, diceNumber, dieSize: dice.die, damageType: type, ...(d.category ? { category: d.category } : {}) });
    }
    const value = Number(d.value ?? d.dice);
    if (!Number.isFinite(value)) {
      log.warn(`Zusatzschaden „${JSON.stringify(eff.extraDamage)}“ nicht lesbar.`);
      return null;
    }
    return common(eff, { key: "FlatModifier", selector, value, ...(type ? { damageType: type } : {}), ...(d.category ? { damageCategory: d.category } : {}) });
  }

  // Resistenz, Schwäche, Immunität
  for (const [field, key] of [["resistance", "Resistance"], ["weakness", "Weakness"]]) {
    if (eff[field] !== undefined) {
      checkDamageType(eff[field]);
      return common(eff, { key, type: eff[field], value: eff.value ?? 5 });
    }
  }
  if (eff.immunity !== undefined) return common(eff, { key: "Immunity", type: eff.immunity });

  // Bewegung: { "speed": "climb", "value": 20 }
  if (eff.speed !== undefined) return common(eff, { key: "BaseSpeed", selector: eff.speed, value: eff.value ?? 20 });

  // Sinn: { "sense": "darkvision" } oder { "sense": "scent", "acuity": "imprecise", "range": 30 }
  if (eff.sense !== undefined) {
    return common(eff, {
      key: "Sense", selector: eff.sense,
      ...(eff.acuity ? { acuity: eff.acuity } : {}), ...(eff.range ? { range: eff.range } : {})
    });
  }

  // Beliebiges Regelelement: { "rule": { "key": "...", ... } }
  if (eff.rule?.key) return structuredClone(eff.rule);

  log.warn(`Effekt ${JSON.stringify(eff)} nicht erkannt (bonus, extraDamage, resistance, weakness, immunity, speed, sense, rule).`);
  return null;
}

/* -------------------------------------------- */
/*  Beschreibung                                */
/* -------------------------------------------- */

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Text mit Leerzeilen → Absätze; Text mit HTML bleibt unverändert. */
function toHtml(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  if (/<[a-z][\s\S]*>/i.test(s)) return s;
  return s
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function buildDescription(entry, log) {
  const acts = asArray(entry.activations);
  if (entry.description === undefined && !acts.length) return null;
  let html = toHtml(entry.description);
  for (const a of acts) {
    if (!a || typeof a !== "object") continue;
    const glyph = ACTION_GLYPHS[a.actions];
    if (a.actions !== undefined && !glyph) log.warn(`Aktivierung: „actions“ ${a.actions} unbekannt (1, 2, 3, reaction, free).`);
    const head = [`<strong>Aktivieren${a.name ? `—${escapeHtml(a.name)}` : ""}</strong>`];
    if (glyph) head.push(`<span class="action-glyph">${glyph}</span>`);
    if (a.traits) head.push(`(${asArray(a.traits).map(escapeHtml).join(", ")})`);
    const parts = [head.join(" ")];
    if (a.frequency) parts.push(`<strong>Häufigkeit</strong> ${escapeHtml(a.frequency)}`);
    if (a.trigger) parts.push(`<strong>Auslöser</strong> ${escapeHtml(a.trigger)}`);
    if (a.requirements) parts.push(`<strong>Voraussetzungen</strong> ${escapeHtml(a.requirements)}`);
    html += `<hr /><p>${parts.join("; ")}</p>`;
    if (a.text) html += toHtml(`Effekt: ${a.text}`).replace("<p>Effekt:", "<p><strong>Effekt</strong>");
    if (a.asAction) html += "<p><em>Steht als Aktion im Charakterbogen, solange der Gegenstand angelegt ist.</em></p>";
  }
  return html;
}

/* -------------------------------------------- */
/*  Gewährte Aktionen                           */
/* -------------------------------------------- */

const FREQUENCY_WORDS = [
  [/runde|round/i, "round"],
  [/zug|turn/i, "turn"],
  [/stunde|hour/i, "PT1H"],
  [/minute/i, "PT1M"],
  [/tag|day/i, "day"]
];
const COUNT_WORDS = { einmal: 1, once: 1, zweimal: 2, twice: 2, dreimal: 3, thrice: 3 };

/** { max: 1, per: "day" } aus Objekt oder Text wie "einmal pro Tag", "1/Tag", "2/day". */
export function parseUses(v, log) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "object") return { max: Math.max(1, Number(v.max) || 1), per: v.per ?? "day" };
  const s = String(v).toLowerCase();
  const per = FREQUENCY_WORDS.find(([rx]) => rx.test(s))?.[1];
  if (!per) {
    log.warn(`Häufigkeit „${v}“ nicht erkannt (z. B. "einmal pro Tag" oder {"max": 1, "per": "day"}), kein Zähler.`);
    return null;
  }
  const word = Object.keys(COUNT_WORDS).find((w) => s.includes(w));
  const max = word ? COUNT_WORDS[word] : Number(s.match(/(\d+)/)?.[1] ?? 1);
  return { max, per };
}

/** Text für den Zauber-leihen-Knopf (siehe borrow.js). */
export function borrowSpellTag(b) {
  const o = { tradition: "arcane", skill: "arcana", dc: 15, rarity: "common", ...b };
  return `@BorrowSpell[tradition:${o.tradition}|skill:${o.skill}|dc:${o.dc}|rarity:${o.rarity}]`;
}

function buildAction(a, entry, log) {
  const actionType = a.actions === "reaction" ? "reaction" : a.actions === "free" ? "free" : "action";
  const count = Number(a.actions);
  const parts = [];
  if (a.trigger) parts.push(`<strong>Auslöser</strong> ${escapeHtml(a.trigger)}`);
  if (a.requirements) parts.push(`<strong>Voraussetzungen</strong> ${escapeHtml(a.requirements)}`);
  let html = parts.length ? `<p>${parts.join("; ")}</p>` : "";
  html += toHtml(a.text);
  if (a.borrowSpell) html += `<p>${borrowSpellTag(a.borrowSpell)}</p>`;
  html += `<p><em>Gewährt von: ${escapeHtml(entry.name)}</em></p>`;

  const uses = parseUses(a.uses ?? a.frequency, log);
  return {
    name: a.name ? String(a.name) : `${entry.name}: Aktivieren`,
    type: "action",
    ...(a.img || entry.img ? { img: a.img ?? entry.img } : {}),
    system: {
      description: { value: html, gm: "" },
      actionType: { value: actionType },
      actions: { value: actionType === "action" ? ([1, 2, 3].includes(count) ? count : 1) : null },
      traits: { value: asArray(a.traits).map(String), otherTags: [] },
      category: null,
      ...(uses ? { frequency: { ...uses, value: uses.max } } : {})
    },
    flags: { [MODULE_ID]: { grantedBy: String(entry.name) } }
  };
}

/* -------------------------------------------- */
/*  Hilfsfunktionen                             */
/* -------------------------------------------- */

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function toInt(v, field, log) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    log.warn(`„${field}“ ist keine Zahl.`);
    return 0;
  }
  return Math.round(n);
}

function clampInt(v, min, max, field, log) {
  const n = toInt(v, field, log);
  if (n < min || n > max) log.warn(`„${field}“ muss zwischen ${min} und ${max} liegen.`);
  return Math.min(max, Math.max(min, n));
}

function parseRuneLevel(v, names, field, log) {
  if (typeof v === "string" && !/^\d+$/.test(v)) {
    if (!(v in names)) log.warn(`„${field}“: „${v}“ unbekannt, nutze 0–3.`);
    return names[v] ?? 0;
  }
  return clampInt(v, 0, 3, field, log);
}

function parseDice(s) {
  const m = String(s).trim().match(/^(\d*)\s*(d\d+)$/i);
  return m ? { count: m[1] ? Number(m[1]) : 1, die: m[2].toLowerCase() } : null;
}

/** "1d6 fire" → { dice: "1d6", type: "fire" }, "2 fire" → { value: 2, type: "fire" } */
function parseDamageString(s) {
  const m = String(s).trim().match(/^(\d*d\d+|\d+)\s*([a-z-]+)?$/i);
  if (!m) return null;
  return /d/i.test(m[1]) ? { dice: m[1], type: m[2]?.toLowerCase() ?? null } : { value: Number(m[1]), type: m[2]?.toLowerCase() ?? null };
}

function parseDamage(v, cfg, log) {
  const d = typeof v === "string" ? parseDamageString(v) : { dice: v.dice && v.die ? `${v.dice}${v.die}` : v.dice, type: v.type ?? v.damageType };
  const dice = d?.dice ? parseDice(d.dice) : null;
  if (!dice || !d.type) {
    log.warn(`„damage“ nicht lesbar (z. B. "1d8 piercing").`);
    return null;
  }
  if (!DIE_SIZES.includes(dice.die)) log.warn(`Würfel „${dice.die}“ ungültig.`);
  if (cfg.damageTypes && !(d.type in cfg.damageTypes)) log.warn(`Schadensart „${d.type}“ unbekannt.`);
  return { dice: dice.count, die: dice.die, type: d.type };
}

/** 25 → 25 gp; "12 gp 5 sp" → { gp: 12, sp: 5 }; { gp: 12 } bleibt */
function parsePrice(v, log) {
  if (typeof v === "number") return { gp: v };
  if (typeof v === "object" && v) return { ...v };
  const out = {};
  for (const m of String(v).matchAll(/(\d+(?:\.\d+)?)\s*(pp|gp|sp|cp)/gi)) out[m[2].toLowerCase()] = Number(m[1]);
  if (!Object.keys(out).length) log.warn(`„price“ nicht lesbar (z. B. 25 oder "12 gp 5 sp").`);
  return out;
}

/** "L" → 0.1, "-" → 0, Zahl bleibt */
function parseBulk(v, log) {
  if (v === "L" || v === "l") return 0.1;
  if (v === "-" || v === "—") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) log.warn(`„bulk“ nicht lesbar (Zahl, "L" oder "-").`);
  return Number.isFinite(n) ? n : 0;
}

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else target[k] = structuredClone(v);
  }
  return target;
}
