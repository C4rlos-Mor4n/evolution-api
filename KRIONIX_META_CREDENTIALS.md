# Rotar el token de Meta de una instancia (sin reiniciar)

```
PATCH /instance/meta-credentials/{instanceName}
apikey: <AUTHENTICATION_API_KEY global>      ← SOLO la clave global; el token de la instancia da 401
Content-Type: application/json

{ "accessToken": "NUEVO_TOKEN_META" }
```

Respuesta 200:
```json
{ "success": true, "instanceName": "demo-meta", "credentialsUpdated": true }
```

## Qué hace

1. Exige la **API key global**, comparada en tiempo constante. Un token de instancia, aunque sea el viejo o uno filtrado, recibe 401. La autenticación se verifica antes de comprobar si la instancia existe, así la ruta no sirve para averiguar nombres de instancias.
2. Comprueba que la instancia exista (si no, 404) y que sea `WHATSAPP-BUSINESS` (si no, 400).
3. Valida el token nuevo contra Meta con `GET /<PHONE_NUMBER_ID>?fields=id` y un timeout de 15 s. El token debe ser válido **y tener acceso a ese número**.
4. Si es válido, actualiza `Instance.token` en Postgres y en la instancia que está corriendo. Los envíos siguientes usan el token nuevo sin reiniciar nada.
5. Si algo falla, conserva el token anterior. Si falla la actualización en memoria, revierte la base de datos.
6. El token nunca se loguea ni se devuelve.

## Errores

| HTTP | Cuándo |
|---|---|
| 400 | Body inválido. El `accessToken` debe tener entre 20 y 255 caracteres, sin espacios y sin campos extra. |
| 400 | Meta rechazó el token, por ejemplo `HTTP 401, code 190`. |
| 400 | El token no tiene acceso a este número. |
| 400 | La instancia no es `WHATSAPP-BUSINESS`. |
| 401 | No se envió la API key global. |
| 404 | La instancia no existe. |
| 500 | Meta no respondió (timeout o error 5xx). El token anterior se mantiene. |

## ⚠️ Importante: el token de Meta también es el `apikey` de la instancia

En evolution-api, en las instancias `WHATSAPP-BUSINESS`, `Instance.token` es a la vez el token de Meta y el `apikey` de esa instancia. Es un diseño de upstream. **Después de rotar:**
- El token viejo deja de servir como `apikey` de la instancia: responde 401.
- Quien llame a esa instancia, por ejemplo Nix360, debe usar el **token nuevo** como `apikey`, o bien la API key global.
- Si el webhook incluye el campo `apikey`, desde ese momento lleva el token nuevo.

Flujo recomendado en Nix360:
1. Llamar a esta ruta con la clave global.
2. Si responde 200, guardar el token nuevo como `apikey` de esa instancia en Nix360.
3. Si responde algo distinto de 200, no cambiar nada.

## Otros detalles

- **CORS:** `CORS_METHODS` del `.env.example` no incluye `PATCH`. No hace falta tocarlo, porque esta ruta se llama desde un backend y nunca desde el navegador, ya que exige la clave global.
- **Límite de longitud:** la columna `token` es `VARCHAR(255)`. Los tokens de Meta más largos se rechazan con 400.
