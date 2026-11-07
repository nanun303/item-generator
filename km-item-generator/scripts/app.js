import { MODULE_ID, buildItems } from "./convert.js";
import { EXAMPLES, FORMAT_GUIDE } from "./examples.js";
import { convertContext, createItems, inputFromDrop } from "./foundry.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const RUNE_LABEL = ["", "Schlag", "Schlag (groß)", "Schlag (überragend)"];

export class ItemGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options) {
    super(options);
    this.formState = {
      json: "",
      example: "staglord",
      folder: "Item-Generator",
      giveToToken: false,
      ...(game.settings.get(MODULE_ID, "state") ?? {})
    };
    this.result = null;
    this.busy = false;
  }

  static DEFAULT_OPTIONS = {
    id: "km-item-generator",
    tag: "form",
    classes: ["km-item"],
    window: { title: "Item-Generator", icon: "fa-solid fa-hammer", resizable: true },
    position: { width: 760, height: 820 },
    form: { handler: ItemGeneratorApp.#onCreate, submitOnChange: false, closeOnSubmit: false },
    actions: {
      check: ItemGeneratorApp.#onCheck,
      loadExample: ItemGeneratorApp.#onLoadExample,
      copyFormat: ItemGeneratorApp.#onCopyFormat,
      format: ItemGeneratorApp.#onFormat
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/generator.hbs`, scrollable: [".kmi-result"] }
  };

  async _prepareContext() {
    return {
      state: this.formState,
      examples: Object.fromEntries(Object.entries(EXAMPLES).map(([k, v]) => [k, v.label])),
      result: this.result && {
        errors: this.result.errors,
        warnings: this.result.warnings,
        items: this.result.items.map(summarize),
        ok: !this.result.errors.length && this.result.items.length > 0
      },
      tokenName: canvas.tokens?.controlled[0]?.actor?.name ?? null
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const textarea = this.element.querySelector("textarea[name=json]");
    // Ein vom Generator erstelltes Item hierher ziehen: sein JSON wird zum Bearbeiten geladen
    textarea?.addEventListener("drop", async (event) => {
      event.preventDefault();
      const input = await inputFromDrop(event);
      if (!input) return;
      if (input.notGenerated) {
        ui.notifications.warn(`„${input.notGenerated}“ wurde nicht mit dem Item-Generator erstellt.`);
        return;
      }
      this.formState.json = JSON.stringify(input, null, 2);
      this.result = null;
      await this.render();
    });
  }

  #readForm() {
    const FDE = foundry.applications.ux?.FormDataExtended ?? globalThis.FormDataExtended;
    const data = new FDE(this.element).object;
    this.formState = {
      json: String(data.json ?? ""),
      example: data.example ?? this.formState.example,
      folder: String(data.folder ?? "").trim(),
      giveToToken: !!data.giveToToken
    };
    game.settings.set(MODULE_ID, "state", this.formState);
    return this.formState;
  }

  async #run(fn) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(`Item-Generator: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }

  async #convert() {
    const { json } = this.#readForm();
    this.result = await buildItems(json, convertContext());
    return this.result;
  }

  static async #onCheck() {
    await this.#run(async () => {
      await this.#convert();
      await this.render();
    });
  }

  static async #onCreate() {
    await this.#run(async () => {
      const result = await this.#convert();
      if (result.errors.length || !result.items.length) {
        await this.render();
        ui.notifications.error("Item-Generator: Es gibt Fehler, nichts wurde erstellt.");
        return;
      }
      const actor = this.formState.giveToToken ? canvas.tokens?.controlled[0]?.actor : null;
      if (this.formState.giveToToken && !actor) ui.notifications.warn("Kein Token ausgewählt, Items nur in der Welt erstellt.");
      const { created, given } = await createItems(result.items, { folderName: this.formState.folder, actor });
      ui.notifications.info(`Item-Generator: ${created.length} Item(s) erstellt${given ? `, ${given} an ${actor.name} gegeben` : ""}.`);
      created[0]?.sheet?.render(true);
      await this.render();
    });
  }

  static async #onLoadExample() {
    const { example } = this.#readForm();
    const ex = EXAMPLES[example];
    if (!ex) return;
    this.formState.json = JSON.stringify(ex.data, null, 2);
    this.result = null;
    await this.render();
  }

  static async #onFormat() {
    const { json } = this.#readForm();
    try {
      this.formState.json = JSON.stringify(JSON.parse(json), null, 2);
      await this.render();
    } catch (err) {
      ui.notifications.warn(`JSON ist ungültig: ${err.message}`);
    }
  }

  static async #onCopyFormat() {
    await navigator.clipboard.writeText(FORMAT_GUIDE);
    ui.notifications.info("Formatbeschreibung kopiert. Füge sie z. B. bei einer KI ein und beschreibe dein Item.");
  }
}

/** Kurzübersicht eines erzeugten Items für die Vorschau. */
function summarize(item) {
  const s = item.system ?? {};
  const lines = [];
  const traits = [s.traits?.rarity && s.traits.rarity !== "common" ? s.traits.rarity : null, ...(s.traits?.value ?? [])].filter(Boolean);
  if (traits.length) lines.push(`Traits: ${traits.join(", ")}`);
  const price = s.price?.value ? Object.entries(s.price.value).map(([k, v]) => `${v} ${k}`).join(" ") : null;
  if (price) lines.push(`Preis: ${price}`);
  if (item.type === "weapon") {
    if (s.damage?.die) lines.push(`Schaden: ${s.damage.dice}${s.damage.die} ${s.damage.damageType}`);
    if (s.reload?.value) lines.push(`Nachladen: ${s.reload.value}`);
    if (s.ammo?.baseType) lines.push(`Munition: ${s.ammo.baseType} (Kapazität ${s.ammo.capacity ?? 1})`);
    if (s.usage?.canBeAmmo) lines.push("Kann als Munition verschossen werden");
    const r = s.runes;
    if (r && (r.potency || r.striking || r.property?.length)) {
      lines.push(`Runen: ${[r.potency ? `+${r.potency}` : null, RUNE_LABEL[r.striking] || null, ...(r.property ?? [])].filter(Boolean).join(", ")}`);
    }
  }
  if (item.type === "armor") {
    lines.push(`RK +${s.acBonus ?? 0}, GE-Max ${s.dexCap ?? "–"}`);
    const r = s.runes;
    if (r && (r.potency || r.resilient || r.property?.length)) lines.push(`Runen: +${r.potency ?? 0}, Widerstand ${r.resilient ?? 0}${r.property?.length ? `, ${r.property.join(", ")}` : ""}`);
  }
  const rules = (s.rules ?? []).map(describeRule);
  for (const g of item._grants ?? []) {
    const f = g.system.frequency;
    const borrow = g.system.description.value.includes("@BorrowSpell") ? ", mit Knopf „Zauber leihen“" : "";
    rules.push(`Gewährt Aktion „${g.name}“${f ? ` (${f.max}/${f.per === "day" ? "Tag" : f.per})` : ""}${borrow}`);
  }
  return {
    name: item.name,
    type: item.type,
    level: s.level?.value ?? 0,
    quantity: s.quantity && s.quantity !== 1 ? s.quantity : null,
    base: item._stats?.compendiumSource ?? null,
    lines,
    rules,
    description: s.description?.value ?? "",
    sourceJson: JSON.stringify(item, null, 2)
  };
}

function describeRule(r) {
  switch (r.key) {
    case "FlatModifier":
      return `${r.label ? `${r.label}: ` : ""}${r.value >= 0 ? "+" : ""}${r.value}${r.damageType ? ` ${r.damageType}` : ""} (${r.type ?? "untyped"}) auf ${[r.selector].flat().join(", ")}`;
    case "DamageDice":
      return `${r.label ? `${r.label}: ` : ""}+${String(r.diceNumber).includes("@item.system.damage.dice") ? `(${String(r.diceNumber).replace("@item.system.damage.dice", "Waffenwürfel")})` : r.diceNumber}${r.dieSize} ${r.damageType ?? ""} auf ${[r.selector].flat().join(", ")}`;
    case "Resistance":
    case "Weakness":
      return `${r.key === "Resistance" ? "Resistenz" : "Schwäche"} ${r.type} ${r.value}`;
    case "Immunity":
      return `Immunität ${r.type}`;
    case "BaseSpeed":
      return `Bewegung ${r.selector} ${r.value} ft`;
    case "Sense":
      return `Sinn ${r.selector}${r.range ? ` ${r.range} ft` : ""}`;
    default:
      return `Regelelement ${r.key}`;
  }
}
