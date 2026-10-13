# Llamadas de WhatsApp (Cloud API Calling) — integración

Disponible solo en instancias `WHATSAPP-BUSINESS`. Es la API **oficial** de Meta: sin riesgo de baneo y sin código propietario.

Alcance actual: **llamadas entrantes** (el cliente llama a la empresa) y configuración de llamadas del número.

## Cómo funciona

Evolution solo **relaya la señalización**. El audio viaja por WebRTC directamente entre WhatsApp y el navegador del agente, así que no hace falta un servidor de medios.

```
Cliente (WhatsApp)          Meta              Evolution API                 Nix360 (navegador del agente)
   | toca "llamar"            |                     |                                  |
   |------------------------->| webhook calls       |                                  |
   |                          | event=connect + SDP |                                  |
   |                          |-------------------->| evento CALL (callId, sdp, from)  |
   |                          |                     |--------------------------------->| suena / el agente contesta
   |                          |                     |   POST /call/preAccept {sdp}     | RTCPeerConnection: answer
   |                          |<--------------------|<---------------------------------|
   |                          |                     |   POST /call/accept {sdp}        |
   |                          |<--------------------|<---------------------------------|
   |<=============== audio WebRTC (Opus), directo con el navegador =================>|
   |  cuelga                  | webhook calls       |                                  |
   |                          | event=terminate     | evento CALL (status, duration)   |
   |                          |-------------------->|--------------------------------->|
```

## Requisitos en Meta (una vez por número)

1. El número debe tener un **límite de mensajería de 2000 o más**.
2. Suscribir el campo de webhook **`calls`** en la app de Meta (además de `messages`).
3. Activar las llamadas en el número, con el endpoint de abajo o en WhatsApp Manager → Números → ⚙ → Llamadas.
4. La instancia debe tener suscrito el evento **`CALL`** en su webhook.

> Contestar importa: si las llamadas no se atienden, Meta puede ocultar el botón de llamada. Cuando nadie atiende, rechaza la llamada con `/call/reject`.

## Endpoints

Todos usan el `apikey` de la instancia.

| Método | Ruta | Body | Qué hace |
|---|---|---|---|
| POST | `/call/preAccept/{instance}` | `{ "callId", "sdp" }` | Abre la conexión de medios antes de aceptar (evita que se corte el inicio del audio). |
| POST | `/call/accept/{instance}` | `{ "callId", "sdp", "bizOpaqueCallbackData"? }` | Acepta la llamada. El `sdp` debe ser **el mismo** que se envió en preAccept. |
| POST | `/call/reject/{instance}` | `{ "callId" }` | Rechaza la llamada. |
| POST | `/call/terminate/{instance}` | `{ "callId" }` | Cuelga desde el lado del agente. |
| GET | `/call/settings/{instance}` | — | Lee la configuración de llamadas del número. |
| POST | `/call/settings/{instance}` | `{ "calling": { ... } }` | Activa las llamadas, el horario, los feriados y el buzón de voz (formato de Meta). |

Errores:
- 400 cuando el dato es inválido o Meta lo rechaza. El mensaje incluye el HTTP y el código de Meta; por ejemplo, un token vencido aparece como `HTTP 401, code 190`.
- 500 cuando Meta no responde (timeout de 15 s) o falla internamente.

Ejemplo para activar llamadas con horario:

```json
POST /call/settings/{instance}
{
  "calling": {
    "status": "ENABLED",
    "call_icon_visibility": "DEFAULT",
    "call_hours": {
      "status": "ENABLED",
      "timezone_id": "America/Guayaquil",
      "weekly_operating_hours": [
        { "day_of_week": "MONDAY", "open_time": "0800", "close_time": "1800" }
      ]
    }
  }
}
```

## Evento `CALL`

Entrante (`event: "connect"`):

```json
{
  "event": "call",
  "data": {
    "provider": "cloud_api",
    "callId": "wacid.HBgM...",
    "event": "connect",
    "direction": "USER_INITIATED",
    "from": "593900000001",
    "fromJid": "593900000001@s.whatsapp.net",
    "to": "593222222222",
    "pushName": "Ana",
    "timestamp": 1760000000,
    "sdpType": "offer",
    "sdp": "v=0\r\n..."
  }
}
```

Fin (`event: "terminate"`): trae `status` (`COMPLETED`, `FAILED`...) y, si se contestó, `startTime`, `endTime` y `duration` (segundos). También incluye `bizOpaqueCallbackData` (lo que mandaste en accept) y `errors[]` si falló.

## Código del navegador (Nix360)

Se contesta en unos **30–60 s**; si no, Meta marca "No contestada" y manda el `terminate`.

```js
// llamado cuando llega el evento CALL con event === 'connect'
async function answerWhatsAppCall({ instance, apikey, call }) {
  // Meta publica sus candidatos en la oferta. Si el agente está detrás de un NAT estricto,
  // agrega un STUN/TURN propio en iceServers.
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  mic.getTracks().forEach((track) => pc.addTrack(track, mic));

  const remoteAudio = new Audio();
  remoteAudio.autoplay = true;
  pc.ontrack = (e) => { remoteAudio.srcObject = e.streams[0]; };

  await pc.setRemoteDescription({ type: 'offer', sdp: call.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  // esperar a que se junten los ICE candidates para mandar un SDP completo
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && resolve());
    setTimeout(resolve, 3000);
  });
  const sdp = pc.localDescription.sdp;

  const post = (path, body) =>
    fetch(`${EVOLUTION_URL}/call/${path}/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify(body),
    }).then((r) => { if (!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); });

  await post('preAccept', { callId: call.callId, sdp });
  await post('accept', { callId: call.callId, sdp, bizOpaqueCallbackData: 'ticket-123' });
  return {
    pc,
    hangup: async () => { await post('terminate', { callId: call.callId }); pc.close(); mic.getTracks().forEach((t) => t.stop()); },
  };
}
```

- **Llamar a Evolution desde el backend:** no expongas el `apikey` de la instancia en el navegador; haz que el navegador hable con un endpoint de Nix360 que reenvía a Evolution.
- **Cuando el cliente cuelga:** llega el `CALL` con `event: "terminate"`. Cierra el `RTCPeerConnection` y registra la duración.
- **Si ningún agente contesta:** llama a `/call/reject` antes de que expire la ventana.

## Privacidad

Los logs de Evolution reemplazan todo `sdp` por `[redacted]`, porque contiene credenciales ICE e IPs. El SDP solo viaja en el evento `CALL` hacia tu webhook.

## No incluido (todavía)

- Llamadas salientes (iniciadas por la empresa): requieren pedir permiso al cliente con una plantilla y Meta las cobra.
- SIP: Meta puede entregar las llamadas a un servidor SIP (Asterisk/FreeSWITCH) en lugar de usar webhooks. Se configura en `calling.sip`, pero con SIP activo no llegan los webhooks de llamadas.

Referencia oficial: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling
