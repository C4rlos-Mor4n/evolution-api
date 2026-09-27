# Evolution API 2.3.7 Meta Patch

Build derivada, **no es una release oficial upstream**.

Base:
- upstream: evolution-foundation/evolution-api
- version: v2.3.7 (git tag `2.3.7`, commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`)

Custom version:
- 2.3.7-meta.1

Fixes:
- safe handling of Meta contacts without profile.name
- continue processing status batches when an individual wamid cannot be resolved

Upstream references:
- #2514 (contact guard, only the `pushName`/`contacts[0]` part is applied)
- #2573 (issue: MESSAGES_UPDATE lost on Cloud API status webhooks)
- #2715 (return -> continue inside the statuses loop; still open upstream)

Scope:
- Meta WhatsApp Business / Cloud API only
- File: `src/api/integrations/channel/meta/whatsapp.business.service.ts` (`messageHandle`)

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

`test/meta-statuses.test.ts` (node:test vía tsx; `/test/` está en `.gitignore` upstream, se agregó con `git add -f`):

```bash
npx tsx --test test/meta-statuses.test.ts
```

Contra 2.3.7 sin parche: 4 de 6 fallan (TEST 1, 3, 4 y batch con error). Con el parche: 6/6 pasan.

## Trazabilidad

Docker image:
- PENDING (bloqueado: registry/credenciales no provistas)

Git commit (fix):
- ver `git log krionix/meta-2.3.7` (commit `fix(meta): restore Cloud API message status processing`)

Docker digest:
- PENDING
