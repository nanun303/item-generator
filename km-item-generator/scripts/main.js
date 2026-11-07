import { MODULE_ID, buildItems } from "./convert.js";
import { ItemGeneratorApp } from "./app.js";
import { convertContext, createItems } from "./foundry.js";

let app = null;

export function openGenerator() {
  if (!game.user.isGM) {
    ui.notifications.warn("Der Item-Generator ist nur für die Spielleitung verfügbar.");
    return null;
  }
  app ??= new ItemGeneratorApp();
  app.render(true);
  return app;
}

/** Startet aus dem Einstellungsmenü immer dasselbe Fenster. */
class GeneratorLauncher {
  render() {
    openGenerator();
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "state", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.registerMenu(MODULE_ID, "open", {
    name: "KMITEM.Title",
    label: "KMITEM.Open",
    hint: "KMITEM.MenuHint",
    icon: "fa-solid fa-hammer",
    type: GeneratorLauncher,
    restricted: true
  });

  // Für Makros: game.modules.get("km-item-generator").api.create({ ... })
  game.modules.get(MODULE_ID).api = {
    open: openGenerator,
    build: (input) => buildItems(input, convertContext()),
    async create(input, options = {}) {
      const result = await buildItems(input, convertContext());
      if (result.errors.length) throw new Error(result.errors.join("\n"));
      return createItems(result.items, options);
    }
  };
});

// Button in der Item-Seitenleiste
Hooks.on("renderItemDirectory", (directory, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".kmi-open")) return;
  const header = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
  if (!header) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kmi-open";
  button.innerHTML = '<i class="fa-solid fa-hammer"></i> Item-Generator';
  button.addEventListener("click", () => openGenerator());
  header.append(button);
});
