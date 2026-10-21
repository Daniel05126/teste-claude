// Weiterleitungsdienst für "Schiffe versenken": verbindet je Spielcode genau zwei Spieler
// und reicht ihre Nachrichten unverändert weiter. Er speichert nichts dauerhaft und
// wertet keine Spielzüge aus; die Prüfung übernehmen die Spiele selbst.
"use strict";

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8080;
const PFAD = process.env.WS_PFAD || "/spiele-ws";
const MAX_SPIELE = Number(process.env.MAX_SPIELE) || 500;
const MAX_NACHRICHT = 16 * 1024;              // Bytes je Nachricht
const MAX_PRO_SEKUNDE = 30;                    // Nachrichten je Verbindung und Sekunde
const SPIEL_ABLAUF = 24 * 60 * 60 * 1000;      // unbenutzte Spiele nach 24 Stunden löschen

const ROLLEN = ["gastgeber", "gast"];
const anderer = rolle => (rolle === "gast" ? "gastgeber" : "gast");

// code -> { token: { gastgeber, gast }, socket: { gastgeber, gast }, zuletzt }
const spiele = new Map();

function log(...teile) {
  console.log(new Date().toISOString(), ...teile);
}

// Eigene Nachrichten beginnen mit "!", damit ein Spieler sie nicht nachahmen kann:
// von Spielern wird nur weitergereicht, was mit "{" beginnt.
function sendeJson(ws, nachricht) {
  if (ws && ws.readyState === ws.OPEN) ws.send("!" + JSON.stringify(nachricht));
}

function meldeStatus(spiel) {
  for (const rolle of ROLLEN) {
    sendeJson(spiel.socket[rolle], { typ: "_status", gegner: !!spiel.socket[anderer(rolle)] });
  }
}

// Prüft die Anmeldung und liefert das Spiel oder einen Fehlergrund
function melde(code, rolle, token) {
  let spiel = spiele.get(code);
  if (rolle === "gastgeber") {
    if (!spiel) {
      if (spiele.size >= MAX_SPIELE) return { fehler: "ausgelastet" };
      spiel = { token: { gastgeber: token, gast: null }, socket: { gastgeber: null, gast: null }, zuletzt: Date.now() };
      spiele.set(code, spiel);
      return { spiel };
    }
    return spiel.token.gastgeber === token ? { spiel } : { fehler: "belegt" };
  }
  if (!spiel) return { fehler: "unbekannt" };
  if (!spiel.token.gast) spiel.token.gast = token;
  return spiel.token.gast === token ? { spiel } : { fehler: "voll" };
}

const server = http.createServer((req, res) => {
  res.writeHead(req.url === "/gesund" ? 200 : 404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(req.url === "/gesund" ? "ok" : "nicht gefunden");
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_NACHRICHT });

server.on("upgrade", (req, socket, kopf) => {
  const url = new URL(req.url, "http://intern");
  const code = url.searchParams.get("spiel") || "";
  const rolle = url.searchParams.get("rolle") || "";
  const token = url.searchParams.get("token") || "";

  // Nur Seiten derselben Adresse dürfen sich verbinden, keine fremden Webseiten
  const origin = req.headers.origin;
  let originOk = false;
  try { originOk = !!origin && new URL(origin).host === req.headers.host; } catch (e) {}

  if (url.pathname !== PFAD || !originOk || !/^[a-z0-9]{8}$/.test(code) ||
      !ROLLEN.includes(rolle) || !/^[a-z0-9]{16,64}$/.test(token)) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, kopf, ws => verbunden(ws, code, rolle, token));
});

function verbunden(ws, code, rolle, token) {
  const { spiel, fehler } = melde(code, rolle, token);
  if (fehler) {
    sendeJson(ws, { typ: "_fehler", grund: fehler });
    ws.close(4000, fehler);
    return;
  }

  // Dieselbe Person verbindet sich neu (z. B. nach Neuladen): alte Verbindung ersetzen
  const alt = spiel.socket[rolle];
  spiel.socket[rolle] = ws;
  if (alt) alt.close(4001, "ersetzt");
  spiel.zuletzt = Date.now();
  log("verbunden", code, rolle);
  meldeStatus(spiel);

  let fenster = Date.now();
  let anzahl = 0;
  ws.lebt = true;
  ws.on("pong", () => { ws.lebt = true; });

  ws.on("message", (daten, binaer) => {
    const jetzt = Date.now();
    if (jetzt - fenster > 1000) { fenster = jetzt; anzahl = 0; }
    if (++anzahl > MAX_PRO_SEKUNDE) {
      ws.close(4002, "zu viele Nachrichten");
      return;
    }
    if (binaer) return;
    const text = daten.toString();
    if (text[0] !== "{") return;
    spiel.zuletzt = jetzt;
    const ziel = spiel.socket[anderer(rolle)];
    if (ziel && ziel.readyState === ziel.OPEN) ziel.send(text);
  });

  ws.on("close", () => {
    if (spiel.socket[rolle] !== ws) return;
    spiel.socket[rolle] = null;
    spiel.zuletzt = Date.now();
    log("getrennt", code, rolle);
    meldeStatus(spiel);
  });

  ws.on("error", () => {});
}

// Tote Verbindungen erkennen und alte Spiele aufräumen
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.lebt) { ws.terminate(); continue; }
    ws.lebt = false;
    ws.ping();
  }
  const grenze = Date.now() - SPIEL_ABLAUF;
  for (const [code, spiel] of spiele) {
    if (!spiel.socket.gastgeber && !spiel.socket.gast && spiel.zuletzt < grenze) spiele.delete(code);
  }
}, 30000);

server.listen(PORT, () => log(`Weiterleitungsdienst läuft auf Port ${PORT}, Pfad ${PFAD}`));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    for (const ws of wss.clients) ws.close(1001, "Neustart");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
