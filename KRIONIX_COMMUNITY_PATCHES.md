# Evolution API 2.3.7 — community PRs integrated (Krionix)

Build derivada, **no es una release oficial upstream**.

- Base: `krionix/meta-2.3.7` (tag upstream `2.3.7` + parche Meta, ver `KRIONIX_META_PATCH.md`)
- Rama: `krionix/community-2.3.7`
- Imagen candidata publicada (Docker Hub, pública, linux/amd64), construida desde el commit `c55242fa`:
  `docker.io/c4rlosmor4n/evolution-api:2.3.7-meta.3-rc1@sha256:45e274d881b22efc99941da7626baf32537f44d2594b853a6e7197c84ea1be64`
  Es un **release candidate**: usarla en demo antes de producción.
- Sin cambios en `prisma/`, migraciones, `package.json` ni `package-lock.json`.
- Revisión: triage de los 82 PRs abiertos de upstream; revisión independiente del diff final (sus hallazgos están corregidos).

## Seguridad

| Cambio | Origen |
|---|---|
| `?instanceName=` en query/body ya no reemplaza la instancia autenticada (bypass entre tenants, CWE-639) | develop `7a55a2bf` (#2435), #2735 |
| La excepción de `/instance/fetchInstances` y `/instance/create` se decide por la ruta exacta, no por `originalUrl.includes()` (que permitía saltarse el fix anterior con `?x=/instance/fetchInstances`) | Krionix (hallazgo de revisión) |
| Guardas de body/participants indefinidos en rutas de grupos | #2733 |
| `fetchInstances` oculta `token` si `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES` no es `true`. En Docker el `.env` copiado de `.env.example` lo deja en `true`, así que el comportamiento no cambia salvo que se configure `false` | #2736 |
| Verificación `X-Hub-Signature-256` en `/webhook/meta` | port de #2749 |

## Meta Cloud API

| Cambio | Origen |
|---|---|
| **Condición de carrera**: `remoteJid` venía de `this.phoneNumber`, compartido entre webhooks concurrentes y leído después de un `await`. Un mensaje podía quedar en el chat de otro contacto. Ahora se toma de `message.from` / `status.recipient_id`, y los handlers se esperan con `await` | port de develop `b9c7f267` (#2493) / #2749 |
| Se procesa cada `entry` × `change` del webhook (antes solo `entry[0].changes[0]`) | #2749 / #2637 |
| Se procesan todos los mensajes del lote (antes solo `messages[0]`), cada uno con el `pushName` de su remitente | #2749 |
| `fromMe` de los estados ahora es `true` (antes siempre `false`) | develop #2514 |
| `contact.updateMany` se acota por `instanceId` (antes tocaba el mismo `remoteJid` en todas las instancias) | #2749 |
| Los FAILED reenvían `errors[]` de Meta en `MESSAGES_UPDATE` (solo en el webhook, no se guarda) | #2637 |
| Un error en un change nunca devuelve 5xx a Meta (evita reintentos y duplicados). Las instancias no cargadas se registran en el log | #2637 |
| Botón CTA URL en `sendButtons` (`type: 'url'`), con 400 si se mezcla con otros botones o si `displayText` pasa de 20 caracteres | #2634 + Krionix |

Variables nuevas:

```
WA_BUSINESS_APP_SECRET=            # App Secret(s) de Meta, separados por coma
WA_BUSINESS_WEBHOOK_SIGNATURE_MODE= # off | log | enforce (por defecto: log si hay secret, off si no)
```

Para el rollout, primero `log`: revisar en los logs que no aparezca `Meta webhook signature invalid` y recién después pasar a `enforce`.

## Baileys (WhatsApp Web)

| Cambio | Origen |
|---|---|
| `AppStateSyncKeyData.fromObject` en los 3 auth-states | #2685 |
| `messageSubject` se recrea si quedó detenido (antes la instancia dejaba de procesar mensajes tras un logout) | #2717 |
| `MESSAGES_UPSERT` ya no se pierde cuando falla o se salta la subida a S3 | #2720 |
| Los reintentos ya no reenvían un mensaje vacío ni uno borrado | #2728 + #2751 |
| Crash en PTT de iOS (`ephemeralMessage` sin mensaje interno) | #2552 |
| `quoted` en audio, caché de metadata de grupo y filtro de la lista de proxies | #2722, #2681, #2416 |
| Borrar una instancia ya no falla si el logout falla | #2508 |
| Se reinicia el contador de QR al hacer logout | #2560 (parcial) |
| `unreadMessages` en `messaging-history.set` | #2561 (parcial) |
| Se cierra el socket anterior antes de crear otro; la creación se serializa (timeout de 60 s) y se ignoran los eventos de sockets ya reemplazados. Evita peleas 440 y bucles de reconexión | #2655 + #2656 + Krionix |

## Chatwoot

#2716 (deduplicación por `key.id`), #2622 (marca los mensajes fallidos; aislado con try/catch y con `UPDATE` acotado por `account_id`), #2579, #2683, #2666 (sin el texto de respaldo en portugués), #2754 (solo `findContactByIdentifier`).

## Eventos

#2652 adaptado: `groups.update` ahora llega a las suscripciones `GROUP_UPDATE` y `GROUPS_UPDATE` (webhook, websocket, rabbitmq, sqs, nats, kafka, pusher), sin romper configuraciones existentes.

## Descartados (motivo)

- **#2727** (pairing `companion_reg_refresh`): requiere portar a mano código de protocolo de Baileys a la rc.9, que no tiene las APIs que usa. Riesgo alto. Para conexiones QR se recomienda evolution-go.
- **#2559**: además del flag, agregaba `EVOLUTIONBOT_ENABLED=false` a `.env.example`, que el Dockerfile copia como `.env`. Eso apagaría EvolutionBot en todas las imágenes.
- **#2471**: poco valor, toca muchos archivos y parte de su cambio choca con el schema de 2.3.7.
- **#2715, #2741, #2691**: ya estaban incluidos en meta.1/meta.2.
- **No aplican a 2.3.7, duplicados o demasiado grandes:** #2750, #2637 (resto), #2639 (loguea payloads con PII), #2747, #2611, #2568 (migración), #2564/#2725 (renombran la variable de BD), #2421/#2660, #2581 (contrato breaking), #2587, #2480, #2614, #2608, #2671, #2599–#2603, #2590, #2729, #2730, #2610, #2684, #2571, #2427, #2657, #2612, #2732, #2680, #2532, #2654, #2708, #2734, #2663, #2688, #2450, #2627, #2703, #2674, #2651, #2742, #2673, #2595, #2623, #2624, #2625, #2628.

## Cambios de contrato visibles para consumidores

1. Cloud API `MESSAGES_UPDATE`:
   - `fromMe=true` en los estados.
   - `remoteJid` es el destinatario de cada estado.
   - `errors[]` opcional en los FAILED.
2. Cloud API: un `MESSAGES_UPSERT` por cada mensaje del lote y por cada `entry`/`change`.
3. `POST /webhook/meta` puede responder 401 en modo `enforce`.
4. Se ignora `?instanceName=` en las rutas de instancia.
5. `groups.update` ahora sí se entrega.
6. Baileys:
   - `CHATS_SET` incluye `unreadMessages`.
   - Las revocaciones se guardan como `DELETED`.
   - Los ERROR salientes se guardan y se marcan en Chatwoot.
7. `DELETE /instance/delete` devuelve SUCCESS aunque falle el logout.

## Verificación

- `npm run lint:check`, `npm run build`: PASS.
- `npx tsx --test test/*.test.ts`: 28/28 PASS. Archivos: `meta-statuses`, `meta-controller`, `meta-signature`, `event-aliases`, `router-instance-scope`. Los tests de regresión de la condición de carrera y del bypass fallan con el código anterior.
- Smoke test de la imagen con Postgres y una API de Meta simulada (sin credenciales reales):
  - Bypass bloqueado.
  - Firma: 401 sin firma o con firma mala, 200 con firma válida.
  - Webhook con varias entradas y varios mensajes: cada evento se entrega una sola vez y con su `remoteJid`/`pushName` correcto.
  - Cero `TypeError` y cero reinicios.
- **Pendiente:** QA con Meta real y con WhatsApp Web real en un entorno demo.
