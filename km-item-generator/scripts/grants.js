/**
 * Gewährte Aktionen selbst verwalten (statt PF2e-GrantItem):
 * - Ein Gegenstand trägt in flags["km-item-generator"].grants die UUIDs seiner Aktionen (Welt-Items).
 * - Sobald er beim Charakter angelegt und, falls nötig, investiert ist, bekommt der Charakter die Aktionen.
 * - Beim Ablegen bleiben sie samt Tageszähler (sonst ließe sich die Nutzung durch Ab- und Anlegen zurücksetzen).
 * - Wird der Gegenstand gelöscht oder weggegeben, verschwinden sie.
 *
 * Warum nicht GrantItem: PF2e lässt Regeln auf Ausrüstung ruhen, solange sie nicht angelegt ist, und
 * GrantItem mit reevaluateOnUpdate verlangt eine Bedingung. Damit erscheint die Aktion nie zuverlässig.
 */
import { MODULE_ID } from "./convert.js";

/** Ist der Gegenstand gerade aktiv? Investierbare müssen investiert sein, andere angelegt. */
export function isActive(item) {
  if (item.isInvested === true) return true;
  if (item.isInvested === false) return false;
  return !!item.isEquipped;
}

export function grantsOf(item) {
  return item.getFlag?.(MODULE_ID, "grants") ?? [];
}

/** Welche Aktionen fehlen beim Charakter noch? (reine Logik) */
export function missingGrants(grantUuids, actorItems, granterId) {
  return grantUuids.filter(
    (uuid) => !actorItems.some((i) => i.getFlag?.(MODULE_ID, "grantedFrom") === granterId && i.getFlag?.(MODULE_ID, "grantUuid") === uuid)
  );
}

export function grantedItems(actor, granterId) {
  return actor.items.filter((i) => i.getFlag(MODULE_ID, "grantedFrom") === granterId);
}

/** Legt fehlende Aktionen an, wenn der Gegenstand aktiv ist. */
export async function syncGrants(item) {
  const actor = item.actor;
  const grants = grantsOf(item);
  if (!actor || !grants.length || !isActive(item)) return [];
  const missing = missingGrants(grants, actor.items.contents, item.id);
  if (!missing.length) return [];
  const sources = [];
  for (const uuid of missing) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) {
      ui.notifications.warn(`${item.name}: gewährte Aktion nicht gefunden (${uuid}). Wurde sie aus der Welt gelöscht?`);
      continue;
    }
    const source = doc.toObject();
    delete source._id;
    delete source.folder;
    source._stats = { ...(source._stats ?? {}), compendiumSource: uuid };
    source.flags = { ...(source.flags ?? {}), [MODULE_ID]: { ...(source.flags?.[MODULE_ID] ?? {}), grantedFrom: item.id, grantUuid: uuid } };
    sources.push(source);
  }
  return sources.length ? actor.createEmbeddedDocuments("Item", sources) : [];
}

export function registerGrantHooks() {
  // Nur der Client, der die Änderung gemacht hat, legt an oder löscht – sonst doppelt
  Hooks.on("createItem", (item, options, userId) => {
    if (userId === game.user.id && item.actor && grantsOf(item).length) syncGrants(item);
  });
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (userId !== game.user.id || !item.actor || !grantsOf(item).length) return;
    if (changes.system?.equipped !== undefined) syncGrants(item);
  });
  Hooks.on("deleteItem", (item, options, userId) => {
    if (userId !== game.user.id || !item.actor || !grantsOf(item).length) return;
    const ids = grantedItems(item.actor, item.id).map((i) => i.id);
    if (ids.length) item.actor.deleteEmbeddedDocuments("Item", ids);
  });
}
