# Evolution API 2.3.7 Meta Patch

Build derivada, **no es una release oficial upstream**.

Base:
- upstream: evolution-foundation/evolution-api
- version: v2.3.7 (git tag `2.3.7`, commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`)

Custom versions:
- 2.3.7-meta.1 — status webhooks (commit `831a8db4d49177063d883d9f3f23336fd8e1d178`)
- 2.3.7-meta.2 — meta.1 + media with presigned URLs + always emit status updates + markMessageAsRead (#2741)

Fixes (meta.1):
- safe handling of Meta contacts without profile.name
- continue processing status batches when an individual wamid cannot be resolved

Fixes (meta.2):
- media (image/PDF/video) sent by URL with a query string (e.g. S3 presigned `?X-Amz-...`) no longer fails
- MESSAGES_UPDATE is emitted even when the wamid is not stored in this instance's DB
- `POST /chat/markMessageAsRead/:instance` works on WHATSAPP-BUSINESS instances (upstream PR #2741)

Upstream references:
- #2514 (contact guard, only the `pushName`/`contacts[0]` part is applied)
- #2573 (issue: MESSAGES_UPDATE lost on Cloud API status webhooks)
- #2715 (return -> continue inside the statuses loop; still open upstream)
- #2741 (markMessageAsRead for Cloud API; open upstream, applied verbatim)

Scope:
- Meta WhatsApp Business / Cloud API only
- File: `src/api/integrations/channel/meta/whatsapp.business.service.ts`
  (`messageHandle`, `prepareMediaMessage`, `sendMessageWithTyping`, `markMessageAsRead`)

Not included:
- develop branch
- 2.4 release candidates
- broad Meta refactors (rest of #2514: message_echoes, remoteId resolution, contact remoteJid change)
- PR #2637

## Detalle de cambios

1. `pushName`: `received.contacts[0].profile.name` → `profile?.name ?? name ?? wa_id`.
   Un webhook de `statuses` con `contacts: [{ wa_id }]` (sin `profile`) lanzaba
   `TypeError: Cannot read properties of undefined (reading 'name')`, lo capturaba el
   `try/catch` externo y **no se emitía ningún `MESSAGES_UPDATE`**.
2. `contactRaw.remoteJid`: `received.contacts[0].profile.phone` → `incomingContact?.profile?.phone`.
   Mismo valor que antes (Meta no envía `profile.phone`, así que ya era `undefined`); solo evita el crash.
   No se cambia a `wa_id` para no alterar el comportamiento de contactos de 2.3.7.
3. Loop de `received.statuses`: los tres `return` que abortaban el batch (groups_ignore,
   `wamid` desconocido, rama DELETE) pasan a `continue` (equivalente a #2715).
4. Loop de `received.statuses`: cada status se procesa dentro de su propio `try/catch`, de modo que
   un error puntual (DB, `axios.post` al `webhookUrl` del mensaje, status malformado) se loguea
   (id + status + mensaje de error, sin payload ni tokens) y se continúa con el siguiente.

### meta.2

5. `prepareMediaMessage` (URL): el mimetype se resolvía con `mimeTypes.lookup(urlCompleta)`; con query
   string (`archivo.pdf?X-Amz-...`) devuelve `false`. Ahora el orden es:
   `mimetype` del payload → extensión del **pathname** de la URL → extensión de `fileName` →
   `application/octet-stream`. Para `document` sin `fileName`, el nombre se deduce del pathname
   (fallback `document` en vez de crash por `arrayMatch[1]` nulo).
6. `sendMessageWithTyping`: `message['mimetype']?.startsWith(...)` lanzaba
   `startsWith is not a function` cuando el mimetype era `false` → 400. Ahora comprueba `typeof === 'string'`.
7. Loop de `statuses`: si el `wamid` no existe en la tabla `Message` de esta instancia, igual se emite
   `MESSAGES_UPDATE` (`keyId`, `remoteJid`, `fromMe`, `participant`, `status`, `instanceId`; **sin
   `messageId`**) y no se persiste en `MessageUpdate` (la FK a `Message` lo impide).
   **Cambio de comportamiento deliberado**: antes esos estados se descartaban en silencio. Consumidores
   que emparejan por `keyId` (wamid) ahora los reciben; los que dependían de `messageId` deben tolerar que falte.
8. `markMessageAsRead` (PR #2741, sin cambios): antes respondía 400 "Method not available". Ahora envía
   `{ messaging_product: 'whatsapp', status: 'read', message_id: <wamid> }` a
   `{WA_BUSINESS_URL}/{VERSION}/{number}/messages` por cada `readMessages[].id` y responde
   `{ message: 'Messages marked as read', read: 'success' }`. Errores de Meta → 400 con el mensaje de Meta.

No cambiado: audio por URL (`audioWhatsapp`) sigue usando `mimeTypes.lookup(url)`; no rompe el envío
(el mimetype no se usa al construir el payload de audio).

El mapeo de estados no cambia: `item.status.toUpperCase()` → `SENT` / `DELIVERED` / `READ` / `FAILED`
en `MESSAGES_UPDATE` (contrato público de 2.3.7 intacto).

## Persistencia de estados / regresiones (FASE 6, no implementado)

- El canal Meta no actualiza `Message.status`; cada status agrega una fila en `MessageUpdate`
  (historial append-only) y emite `MESSAGES_UPDATE`.
- Evolution no evita regresiones (`READ -> DELIVERED`) ni deduplica; reenvía lo que manda Meta.
- Agregar esa protección cambiaría el comportamiento público (eventos suprimidos).
- Recomendación: el consumidor debe aplicar orden monotónico
  (`SENT < DELIVERED < READ`; `FAILED` terminal) por `keyId`.

## Tests

`test/meta-statuses.test.ts` (14 tests; node:test vía tsx; `/test/` está en `.gitignore` upstream, se agregó con `git add -f`):

```bash
npx tsx --test test/meta-statuses.test.ts
```

- meta.1: contra 2.3.7 sin parche, 4 de 6 fallan (TEST 1, 3, 4 y batch con error). Con el parche: 6/6.
- meta.2: contra el código de meta.1, 9 de 14 fallan (media, markMessageAsRead, emisión de wamid desconocido). Con el parche: 14/14.

## Trazabilidad

Fork / código:
- https://github.com/C4rlos-Mor4n/evolution-api (rama `krionix/meta-2.3.7`)
- tags git: `2.3.7-meta.1` → `831a8db4d49177063d883d9f3f23336fd8e1d178`, `2.3.7-meta.2` → `f691be7996301440c26937f9aa6b3fe02910d569`

Docker image (Docker Hub, pública, linux/amd64):
- `docker.io/c4rlosmor4n/evolution-api:2.3.7-meta.2` (inmutable)
- `docker.io/c4rlosmor4n/evolution-api:2.3.7-meta` (alias de la línea meta 2.3.7)
- meta.1 no se publicó (solo build local); meta.2 la reemplaza.

Docker digest (2.3.7-meta.2):
- `sha256:59df8ffb4da4e0b604538a6467ad6b1f0f2fb58e2f82a7def3e4db4a5d351826`

Para producción, fijar por digest:

```yaml
image: docker.io/c4rlosmor4n/evolution-api:2.3.7-meta.2@sha256:59df8ffb4da4e0b604538a6467ad6b1f0f2fb58e2f82a7def3e4db4a5d351826
```
