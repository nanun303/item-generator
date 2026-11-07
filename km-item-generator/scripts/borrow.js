/**
 * "Zauber leihen": Wird eine Aktion mit flags["km-item-generator"].borrowSpell benutzt ("Use" im
 * Charakterbogen oder im Argon HUD), öffnet sich ein Fenster. PF2e hat die Tagesnutzung dabei schon verbraucht.
 * 1. Fertigkeitswurf gegen SG
 * 2. bei Erfolg: Auswahl eines Zaubertricks aus dem PF2e-Kompendium, den der Charakter nicht kennt
 * 3. Wirken als angeborener Zauber über einen eigenen Zauber-Eintrag
 */
import { MODULE_ID } from "./convert.js";
import { isActive } from "./grants.js";

const SPELL_PACK = "pf2e.spells-srd";

/* -------------------------------------------- */
/*  Reine Logik (testbar)                       */
/* -------------------------------------------- */

/** Leih-Einstellungen einer Aktion, oder null. */
export function borrowConfigOf(item) {
  return item?.getFlag?.(MODULE_ID, "borrowSpell") ?? null;
}

/**
 * Zaubertricks der Tradition, ohne Fokuszauber, nach Seltenheit gefiltert, ohne bekannte Zauber.
 * @param {object[]} index  Kompendium-Index mit system.traits und system.slug
 * @param {Set<string>} known  Slugs und Namen (klein) der Zauber, die der Charakter schon hat
 * @returns {{uuid: string, name: string}[]}
 */
export function cantripChoices(index, { tradition, rarity }, known = new Set()) {
  return index
    .filter((e) => {
      const t = e.system?.traits ?? {};
      const traits = t.value ?? [];
      if (!traits.includes("cantrip") || traits.includes("focus")) return false;
      if (!(t.traditions ?? []).includes(tradition)) return false;
      if (rarity?.length && !rarity.includes(t.rarity ?? "common")) return false;
      const slug = e.system?.slug ?? null;
      return !known.has(e.name.toLowerCase()) && !(slug && known.has(slug));
    })
    .map((e) => ({ uuid: e.uuid, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------- */
/*  Foundry: Kompendium, Zauber-Eintrag, Wirken */
/* -------------------------------------------- */

async function spellIndex() {
  const pack = game.packs.get(SPELL_PACK);
  if (!pack) throw new Error(`Kompendium ${SPELL_PACK} nicht gefunden.`);
  const index = await pack.getIndex({
    fields: ["system.slug", "system.traits.value", "system.traits.traditions", "system.traits.rarity"]
  });
  return index.map((e) => ({ ...e, uuid: e.uuid ?? `Compendium.${SPELL_PACK}.Item.${e._id}` }));
}

function knownSpells(actor) {
  const known = new Set();
  for (const s of actor.itemTypes?.spell ?? []) {
    known.add(s.name.toLowerCase());
    if (s.slug) known.add(s.slug);
  }
  return known;
}

/** Eigener angeborener Zauber-Eintrag pro Quelle (z. B. "Hut der Zauberkunst"). */
async function borrowEntry(actor, sourceName, tradition, lang) {
  const existing = actor.items.find((i) => i.type === "spellcastingEntry" && i.getFlag(MODULE_ID, "borrowFrom") === sourceName);
  if (existing) return existing;
  const [entry] = await actor.createEmbeddedDocuments("Item", [{
    name: `${lang === "en" ? "Borrowed" : "Geliehen"}: ${sourceName}`,
    type: "spellcastingEntry",
    system: {
      // Angeborene Zauber nutzen Charisma und die beste Zauberkompetenz (mindestens geübt)
      ability: { value: "cha" },
      tradition: { value: tradition },
      prepared: { value: "innate" },
      proficiency: { value: 1 },
      showSlotlessLevels: { value: false }
    },
    flags: { [MODULE_ID]: { borrowFrom: sourceName } }
  }]);
  return entry;
}

/** Legt den gewählten Zauber in den Eintrag (ersetzt den vorherigen) und wirkt ihn. */
async function castBorrowed(actor, sourceName, { tradition, lang }, uuid) {
  const spell = await fromUuid(uuid);
  if (!spell) throw new Error("Zauber nicht gefunden.");
  const entry = await borrowEntry(actor, sourceName, tradition, lang);
  // Den zuletzt geliehenen Zauber entfernen; der neue bleibt bis zum nächsten Mal, damit die Chat-Knöpfe funktionieren
  const old = actor.items.filter((i) => i.type === "spell" && i.system.location?.value === entry.id).map((i) => i.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  const source = spell.toObject();
  delete source._id;
  source.system.location = { ...(source.system.location ?? {}), value: entry.id };
  source.flags = { ...(source.flags ?? {}), [MODULE_ID]: { borrowed: true } };
  const [embedded] = await actor.createEmbeddedDocuments("Item", [source]);
  const liveEntry = actor.items.get(entry.id);
  await liveEntry.cast(actor.items.get(embedded.id), { consume: false });
}

/* -------------------------------------------- */
/*  Fenster                                     */
/* -------------------------------------------- */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BorrowSpellApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** prepaid: die Nutzung wurde schon verbraucht (PF2e "Use"), das Fenster zieht nichts mehr ab */
  constructor({ actor, action, args, prepaid = false }, options) {
    super(options);
    this.actor = actor;
    this.action = action;
    this.args = args;
    this.prepaid = prepaid;
    this.stage = "check";
    this.choices = [];
    this.busy = false;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["km-item", "kmi-borrow"],
    window: { title: "Zauber leihen", icon: "fa-solid fa-hat-wizard" },
    position: { width: 420, height: "auto" },
    form: { handler: BorrowSpellApp.#onCast, submitOnChange: false, closeOnSubmit: false },
    actions: { roll: BorrowSpellApp.#onRoll, cancel: BorrowSpellApp.#onCancel }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/borrow.hbs` } };

  get sourceName() {
    return this.action?.getFlag(MODULE_ID, "grantedBy") ?? this.action?.name ?? "Zauber leihen";
  }

  get uses() {
    const f = this.action?.system?.frequency;
    return f ? { value: f.value ?? f.max, max: f.max } : null;
  }

  async _prepareContext() {
    const stat = this.actor.skills?.[this.args.skill];
    const uses = this.uses;
    return {
      actorName: this.actor.name,
      sourceName: this.sourceName,
      skillLabel: stat?.label ?? this.args.skill,
      dc: this.args.dc,
      uses,
      prepaid: this.prepaid,
      usedUp: !this.prepaid && !!uses && uses.value <= 0,
      stage: this.stage,
      isCheck: this.stage === "check",
      isChoose: this.stage === "choose",
      isFailed: this.stage === "failed",
      choices: this.choices
    };
  }

  async #run(fn) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(`Zauber leihen: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }

  static async #onRoll() {
    await this.#run(async () => {
      const uses = this.prepaid ? null : this.uses;
      if (uses && uses.value <= 0) {
        ui.notifications.warn("Heute schon benutzt.");
        return;
      }
      const granter = this.actor.items.get(this.action?.getFlag(MODULE_ID, "grantedFrom") ?? "");
      if (!this.prepaid && granter && !isActive(granter)) {
        ui.notifications.warn(`${granter.name} ist nicht angelegt bzw. investiert.`);
        return;
      }
      const stat = this.actor.skills?.[this.args.skill] ?? this.actor.getStatistic?.(this.args.skill);
      if (!stat) throw new Error(`${this.actor.name} hat keine Fertigkeit „${this.args.skill}“.`);
      const roll = await stat.roll({
        dc: { value: this.args.dc },
        extraRollOptions: ["action:borrow-spell"],
        label: `Zauber leihen (${this.sourceName})`
      });
      if (!roll) return; // Wurf-Dialog abgebrochen
      if (uses) await this.action.update({ "system.frequency.value": Math.max(0, uses.value - 1) });
      const degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess ?? null;
      if (degree !== null && degree >= 2) {
        this.choices = cantripChoices(await spellIndex(), this.args, knownSpells(this.actor));
        this.stage = "choose";
      } else {
        this.stage = "failed";
      }
      await this.render();
    });
  }

  static async #onCast() {
    await this.#run(async () => {
      const uuid = this.element.querySelector("select[name=spell]")?.value;
      if (!uuid) return;
      await castBorrowed(this.actor, this.sourceName, this.args, uuid);
      await this.close();
    });
  }

  static #onCancel() {
    this.close();
  }
}

/* -------------------------------------------- */
/*  Benutzen der Aktion → Fenster               */
/* -------------------------------------------- */

/**
 * PF2e postet beim Benutzen einer Aktion ("Use" im Charakterbogen oder Argon HUD) eine Chatkarte mit
 * flags.pf2e.origin.uuid und verbraucht dabei die Tagesnutzung. Für Aktionen mit Leih-Einstellungen
 * öffnet sich danach das Fenster beim Spieler, der sie benutzt hat.
 */
export async function onActionUsed(message, userId) {
  if (userId !== game.user.id) return null;
  const uuid = message.flags?.pf2e?.origin?.uuid;
  if (!uuid) return null;
  const action = await fromUuid(uuid).catch(() => null);
  const args = borrowConfigOf(action);
  const actor = action?.actor;
  if (!args || !actor?.isOwner) return null;

  // Gegenstand nicht angelegt/investiert: Nutzung zurückgeben, nichts öffnen
  const granter = actor.items.get(action.getFlag(MODULE_ID, "grantedFrom") ?? "");
  if (granter && !isActive(granter)) {
    const f = action.system.frequency;
    if (f) await action.update({ "system.frequency.value": Math.min(f.max, (f.value ?? 0) + 1) });
    ui.notifications.warn(`${granter.name} ist nicht angelegt bzw. investiert. Die Nutzung wurde zurückgegeben.`);
    return null;
  }
  const app = new BorrowSpellApp({ actor, action, args, prepaid: true });
  app.render(true);
  return app;
}

export function registerBorrowSpell() {
  Hooks.on("createChatMessage", (message, options, userId) => {
    onActionUsed(message, userId).catch((err) => {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(`Zauber leihen: ${err.message}`);
    });
  });
}
