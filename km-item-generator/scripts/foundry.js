/** Foundry-Anbindung: Grund-Items finden, Items anlegen. */
import { MODULE_ID } from "./convert.js";

const EQUIPMENT_PACK = "pf2e.equipment-srd";

let indexCache = null;

/** "Composite Longbow" → "composite-longbow" (wie PF2e-Slugs) */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function equipmentIndex() {
  const pack = game.packs.get(EQUIPMENT_PACK);
  if (!pack) return null;
  indexCache ??= await pack.getIndex({ fields: ["system.slug", "type"] });
  return { pack, index: indexCache };
}

/**
 * Sucht ein Grund-Item: UUID, Slug oder Name im PF2e-Ausrüstungskompendium, sonst ein Welt-Item gleichen Namens.
 * @returns {Promise<{source: object, uuid: string} | null>}
 */
export async function findBase(ref) {
  const key = String(ref).trim();
  if (/^(Compendium|Item)\./.test(key)) {
    const doc = await fromUuid(key);
    return doc ? { source: doc.toObject(), uuid: doc.uuid } : null;
  }
  const lower = key.toLowerCase();
  const slug = slugify(key);
  const eq = await equipmentIndex();
  if (eq) {
    // system.slug ist im Kompendium nicht immer gesetzt, deshalb auch über den Namen vergleichen
    const hit =
      eq.index.find((e) => e.system?.slug === slug) ??
      eq.index.find((e) => e.name.toLowerCase() === lower) ??
      eq.index.find((e) => slugify(e.name) === slug);
    if (hit) {
      const doc = await eq.pack.getDocument(hit._id);
      return { source: doc.toObject(), uuid: doc.uuid };
    }
  }
  const world = game.items.find((i) => i.name.toLowerCase() === lower);
  return world ? { source: world.toObject(), uuid: world.uuid } : null;
}

export function convertContext() {
  return { findBase, config: CONFIG.PF2E ?? {} };
}

async function ensureFolder(name) {
  if (!name) return null;
  return (
    game.folders.find((f) => f.type === "Item" && f.name === name && !f.folder) ??
    (await getDocumentClass("Folder").create({ name, type: "Item" }))
  );
}

/**
 * Legt die Items in der Welt an und gibt sie optional einem Actor.
 * @returns {Promise<{created: Item[], given: number}>}
 */
export async function createItems(items, { folderName, actor } = {}) {
  const folder = await ensureFolder(folderName);
  const ItemCls = getDocumentClass("Item");
  const sources = [];
  for (const raw of items) {
    const item = structuredClone(raw);
    const grants = item._grants ?? [];
    delete item._grants;
    // Gewährte Aktionen zuerst als Welt-Items anlegen, dann per GrantItem verknüpfen.
    // reevaluateOnUpdate: die Aktion erscheint beim Anlegen/Investieren und verschwindet beim Ablegen.
    if (grants.length) {
      const actions = await ItemCls.createDocuments(grants.map((g) => ({ ...g, folder: folder?.id ?? null })));
      item.system.rules = [
        ...(item.system.rules ?? []),
        ...actions.map((a) => ({ key: "GrantItem", uuid: a.uuid, reevaluateOnUpdate: true }))
      ];
    }
    sources.push(item);
  }
  const created = await ItemCls.createDocuments(sources.map((s) => ({ ...s, folder: folder?.id ?? null })));
  let given = 0;
  if (actor) {
    const embedded = await actor.createEmbeddedDocuments("Item", sources.map((s) => structuredClone(s)));
    given = embedded.length;
  }
  return { created, given };
}

/** Holt das gespeicherte Eingabe-JSON eines vom Generator erstellten Items. */
export async function inputFromDrop(event) {
  let data;
  try {
    data = JSON.parse(event.dataTransfer.getData("text/plain"));
  } catch {
    return null;
  }
  if (data?.type !== "Item" || !data.uuid) return null;
  const item = await fromUuid(data.uuid);
  return item?.getFlag(MODULE_ID, "input") ?? { notGenerated: item?.name ?? "?" };
}
