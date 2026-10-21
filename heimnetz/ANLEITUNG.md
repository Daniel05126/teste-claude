# Spiele im Heimnetz auf dem Raspberry Pi

Diese Anleitung bringt **Schiffe versenken**, **Vier gewinnt** und **Wortraten** auf deinen Pi 5,
erreichbar nur im eigenen Netz unter deiner Domain, zum Beispiel `https://spiele.deinedomain.de`.

Die Dateien im Hauptordner des Repositorys (für GitHub Pages) bleiben davon unberührt.

## Was in diesem Ordner liegt

| Datei / Ordner | Zweck |
|---|---|
| `www/` | Die Webseiten: Spieleübersicht und die drei Spiele |
| `relay/` | Kleiner Weiterleitungsdienst für Schiffe versenken (läuft als eigener Docker-Container mit Node.js, auf dem Pi muss nichts installiert werden) |
| `nginx-spiele.conf` | nginx-Konfiguration für die Spiele |
| `docker-compose.beispiel.yml` | Zeigt, was in deine `docker-compose.yml` gehört |

**So funktioniert Schiffe versenken hier:** Beide Handys verbinden sich mit dem Pi, der Pi reicht die
Spielzüge weiter. Er speichert nichts und sieht nur Schüsse und Antworten, nie die Aufstellung der Schiffe.
Vier gewinnt und Wortraten brauchen keinen Server, sie laufen komplett im Browser.

---

## Schritt 1: Repository auf den Pi holen

```bash
sudo git clone -b claude/lucid-lamport-uopnoj https://github.com/Daniel05126/teste-claude.git /opt/teste-claude
```

Liegt es woanders, passe in den folgenden Schritten den Pfad `/opt/teste-claude` an.

## Schritt 2: Domain im Heimnetz auf den Pi zeigen lassen

Die Domain (z. B. `spiele.deinedomain.de`) muss auf die **interne IP des Pi** zeigen, z. B. `192.168.178.50`.
Das geht auf eine dieser Arten:

- **Im Router** als lokaler DNS-Eintrag (bei der Fritz!Box nicht direkt möglich, dann eine der anderen Arten)
- **Mit Pi-hole oder AdGuard Home:** unter „Local DNS“ einen Eintrag anlegen
- **Beim Domain-Anbieter** einen A-Eintrag auf die interne IP setzen.
  Bei der **Fritz!Box** dann unter *Heimnetz → Netzwerk → Netzwerkeinstellungen → DNS-Rebind-Schutz*
  die Domain als Ausnahme eintragen, sonst wird sie blockiert.

**Zertifikat:** Dein bestehendes HTTPS-Zertifikat muss auch diese Domain abdecken
(z. B. ein Wildcard-Zertifikat `*.deinedomain.de`). Wenn nicht: siehe *Variante B* weiter unten,
dort laufen die Spiele unter deiner bestehenden Domain unter `/spiele/`.

## Schritt 3: nginx-Konfiguration anpassen

In `/opt/teste-claude/heimnetz/nginx-spiele.conf`:

1. `spiele.example.de` → deine Domain (kommt **zweimal** vor)
2. `ssl_certificate` und `ssl_certificate_key` → dieselben Pfade, die deine bestehende nginx-Konfiguration
   schon benutzt (so wie sie **im Container** heißen)
3. Die `allow`-Zeilen lassen alle üblichen Heimnetz-Bereiche zu. Passt meistens so.

Damit `git pull` später keine Konflikte macht, kannst du die Datei auch kopieren, z. B. neben deine
`docker-compose.yml`, und dort anpassen. Dann im nächsten Schritt den Pfad zur Kopie eintragen.

## Schritt 4: docker-compose.yml ergänzen

Öffne deine bestehende `docker-compose.yml` (die, in der dein nginx steht) und ergänze, was in
`docker-compose.beispiel.yml` mit **NEU** markiert ist:

```yaml
services:
  nginx:
    # ... wie bisher ...
    volumes:
      # ... deine bisherigen Einträge ...
      - /opt/teste-claude/heimnetz/www:/usr/share/nginx/spiele:ro
      - /opt/teste-claude/heimnetz/nginx-spiele.conf:/etc/nginx/conf.d/spiele.conf:ro
    depends_on:
      - spiele-relay

  spiele-relay:
    build: /opt/teste-claude/heimnetz/relay
    restart: unless-stopped
```

Wichtig: Der Dienst `spiele-relay` muss in **derselben** `docker-compose.yml` wie nginx stehen,
damit nginx ihn unter dem Namen `spiele-relay` findet. Für den Dienst wird **kein Port** freigegeben.

Falls deine nginx-Konfiguration nicht unter `/etc/nginx/conf.d/` liegt, passe das Ziel des zweiten
Eintrags an (`docker compose exec nginx nginx -T | head` zeigt, welche Dateien nginx einliest).

## Schritt 5: Starten

Im Ordner deiner `docker-compose.yml`:

```bash
docker compose up -d --build spiele-relay
docker compose up -d nginx
docker compose exec nginx nginx -t
```

Die letzte Zeile muss `syntax is ok` und `test is successful` melden.

**Prüfen:**

```bash
docker compose ps
```

Bei `spiele-relay` sollte nach etwa einer halben Minute `(healthy)` stehen.
Dann im Heimnetz `https://spiele.deinedomain.de` öffnen: Die Spieleübersicht erscheint.

## Schritt 6: GitHub Pages (optional)

Wenn die Spiele nicht mehr öffentlich über GitHub erreichbar sein sollen:
im Repository *Settings → Pages* → Veröffentlichung abschalten. Der Code bleibt auf GitHub erhalten.

---

## Updates einspielen

```bash
cd /opt/teste-claude && sudo git pull
```

- Änderungen an den Spielen (`www/`) sind **sofort** live.
- Wurde etwas am Weiterleitungsdienst (`relay/`) geändert: im Ordner deiner `docker-compose.yml`
  `docker compose up -d --build spiele-relay`
- Wurde `nginx-spiele.conf` geändert: `docker compose restart nginx`
  (ein `nginx -s reload` reicht dafür nicht immer, weil Docker sonst noch die alte Datei sieht).

Laufende Spiele überstehen einen Neustart des Weiterleitungsdienstes: Die Geräte verbinden sich von selbst neu.

---

## Variante B: unter der bestehenden Domain statt eigener Subdomain

Wenn dein Zertifikat keine eigene Subdomain abdeckt, kannst du die Spiele unter deiner bestehenden
Domain einhängen, z. B. `https://deinedomain.de/spiele/`. Dann `nginx-spiele.conf` **nicht** einbinden,
sondern diese zwei Blöcke in den bestehenden `server { ... }`-Block für Port 443 einfügen:

```nginx
    location /spiele/ {
        alias /usr/share/nginx/spiele/;
        index index.html;
        allow 192.168.0.0/16; allow 10.0.0.0/8; allow 172.16.0.0/12; allow 127.0.0.1; deny all;
    }

    location /spiele-ws {
        allow 192.168.0.0/16; allow 10.0.0.0/8; allow 172.16.0.0/12; allow 127.0.0.1; deny all;
        proxy_pass http://spiele-relay:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $http_host;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
```

Der Rest (Schritte 1, 4, 5) bleibt gleich, nur ohne den Eintrag für `nginx-spiele.conf`.

---

## Wenn etwas nicht klappt

| Was du siehst | Ursache und Lösung |
|---|---|
| **403 Forbidden** | Dein Gerät ist nicht im erlaubten Adressbereich. In `docker compose logs nginx` steht, mit welcher IP die Anfrage kam; diese in die `allow`-Zeilen aufnehmen. |
| Seite lädt nicht / Zertifikatsfehler | DNS zeigt nicht auf den Pi (Schritt 2) oder das Zertifikat deckt die Domain nicht ab. |
| Schiffe versenken: „Keine Verbindung zum Server“ | `docker compose ps` – läuft `spiele-relay`? `docker compose logs spiele-relay` ansehen. Steht `spiele-relay` in derselben `docker-compose.yml` wie nginx? Ist der Block `location /spiele-ws` aktiv? |
| „Spiel nicht gefunden“ | Der Gastgeber hat das Spiel geschlossen, oder der Link ist unvollständig angekommen. Neues Spiel erstellen. |
| „Dieses Spiel hat schon zwei Spieler“ | Der Link wurde schon von einem anderen Gerät benutzt. Neues Spiel erstellen. |

## Sicherheit

- **Nur im Heimnetz:** Keinen Port im Router für die Spiele freigeben. Zusätzlich lässt nginx nur Geräte
  aus Heimnetz-Adressbereichen zu.
- **Weiterleitungsdienst:**
  - Er speichert nichts dauerhaft. Spiele, die 24 Stunden lang niemand benutzt, vergisst er.
  - Er verbindet pro Spiel genau zwei Geräte. Jedes Gerät weist sich dabei mit einem zufälligen
    Geheimwert aus, der nur auf dem Gerät liegt.
  - Er nimmt nur Verbindungen von der eigenen Seite an, keine von fremden Webseiten.
  - Er begrenzt Nachrichtengröße (16 KB) und -anzahl (30 pro Sekunde) und trennt Geräte, die mehr schicken.
  - Er läuft im Container ohne Administratorrechte.
- **Im Protokoll** (`docker compose logs spiele-relay`) stehen nur Spielcode, Rolle und Uhrzeit von
  Verbindungen, keine Spielzüge.
