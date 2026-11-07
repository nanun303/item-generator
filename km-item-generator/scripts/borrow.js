/**
 * "Zauber leihen": Knopf @BorrowSpell[...] in einer Beschreibung öffnet ein Fenster.
 * 1. Fertigkeitswurf gegen SG (verbraucht eine Nutzung der Aktion)
 * 2. bei Erfolg: Auswahl eines Zaubertricks aus dem PF2e-Kompendium, den der Charakter nicht kennt
 * 3. Wirken als angeborener Zauber über einen eigenen Zauber-Eintrag
 */
import { MODULE_ID } from "./convert.js";

const SPELL_PACK = "pf2e.spells-srd";
const TAG_PATTERN = /@BorrowSpell\[([^\]]*)\]/g;

/* -------------------------------------------- */
/*  Reine Logik (testbar)                       */
/* -------------------------------------------- */

/** "tradition:arcane|skill:arcana|dc:15|rarity:common" → Objekt */
export function parseBorrowArgs(text) {
  const out = { tradition: "arcane", skill: "arcana", dc: 15, rarity: ["common"] };
  for (const part of String(text ?? "").split("|")) {
    const [k, ...rest] = part.split(":");
    const v = rest.join(":").trim();
    if (!k || !v) continue;
    const key = k.trim();
    if (key === "dc") out.dc = Number(v) || 0;
    else if (key === "rarity") out.rarity = v.split(",").map((r) => r.trim()).filter(Boolean);
    else if (key === "tradition" || key === "skill") out[key] = v;
  }
  return out;
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
async function borrowEntry(actor, sourceName, tradition) {
  const existing = actor.items.find((i) => i.type === "spellcastingEntry" && i.getFlag(MODULE_ID, "borrowFrom") === sourceName);
  if (existing) return existing;
  const [entry] = await actor.createEmbeddedDocuments("Item", [{
    name: `Geliehen: ${sourceName}`,
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
async function castBorrowed(actor, sourceName, tradition, uuid) {
  const spell = await fromUuid(uuid);
  if (!spell) throw new Error("Zauber nicht gefunden.");
  const entry = await borrowEntry(actor, sourceName, tradition);
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
  constructor({ actor, action, args }, options) {
    super(options);
    this.actor = actor;
    this.action = action;
    this.args = args;
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
      usedUp: !!uses && uses.value <= 0,
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
      const uses = this.uses;
      if (uses && uses.value <= 0) {
        ui.notifications.warn("Heute schon benutzt.");
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
      await castBorrowed(this.actor, this.sourceName, this.args.tradition, uuid);
      await this.close();
    });
  }

  static #onCancel() {
    this.close();
  }
}

/* -------------------------------------------- */
/*  Knopf in Beschreibungen                     */
/* -------------------------------------------- */

async function actorForButton(el) {
  let item = el.dataset.itemUuid ? await fromUuid(el.dataset.itemUuid).catch(() => null) : null;
  let actor = item?.actor ?? null;
  if (!actor) {
    const message = game.messages.get(el.closest("[data-message-id]")?.dataset.messageId ?? "");
    actor = message?.actor ?? null;
  }
  actor ??= canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
  // Die Aktion mit dem Tageszähler gehört zum Charakter
  if (item?.actor !== actor) item = null;
  item ??= actor?.items.find((i) => i.type === "action" && i.system.description?.value?.includes("@BorrowSpell")) ?? null;
  return { actor, action: item };
}

async function onClick(event) {
  const el = event.target.closest?.("[data-kmi-borrow]");
  if (!el) return;
  event.preventDefault();
  event.stopPropagation();
  const { actor, action } = await actorForButton(el);
  if (!actor) {
    ui.notifications.warn("Kein Charakter gefunden. Wähle dein Token aus.");
    return;
  }
  if (!actor.isOwner) {
    ui.notifications.warn(`Du kannst ${actor.name} nicht steuern.`);
    return;
  }
  new BorrowSpellApp({ actor, action, args: parseBorrowArgs(el.dataset.kmiBorrow) }).render(true);
}

export function registerBorrowSpell() {
  CONFIG.TextEditor.enrichers.push({
    pattern: TAG_PATTERN,
    enricher: (match, options) => {
      const a = document.createElement("a");
      a.classList.add("kmi-borrow-button");
      a.dataset.kmiBorrow = match[1];
      const relative = options?.relativeTo;
      if (relative?.uuid) a.dataset.itemUuid = relative.uuid;
      const args = parseBorrowArgs(match[1]);
      a.innerHTML = `<i class="fa-solid fa-hat-wizard"></i> Zauber leihen (SG ${args.dc})`;
      return a;
    }
  });
  document.addEventListener("click", onClick, true);
}
