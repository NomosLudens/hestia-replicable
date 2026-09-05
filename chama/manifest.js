// Chama Local — manifesto estático do Console da TV Box.
// Conteúdo versionado no git, não em disco — mesma lógica que config.js.
import { getPresenceServiceBindings } from "./serviceBindings.js";

export function getManifest() {
  return {
    station: {
      name: "Héstia Console",
      tagline:
        "Héstia organiza, registra e sustenta. Chama Local mede e serve. Presence mostra e consulta.",
      components: [
        {
          name: "Héstia",
          role: "host",
          description: "Console local da TV Box",
        },
        {
          name: "Héstia Console",
          role: "interface",
          description: "A tela dentro da Héstia (web app local)",
        },
        {
          name: "Chama Local",
          role: "sensor",
          description: "Módulo/API somente leitura embutido (o pulso interno)",
        },
      ],
    },
    services: getPresenceServiceBindings(),
    capabilities: {
      readonly: true,
      readonlyByDefault: true,
      controlledWrites: true,
      writeCapabilities: [],
      metrics: true,
      events: true,
      snapshots: true,
    },
  };
}
