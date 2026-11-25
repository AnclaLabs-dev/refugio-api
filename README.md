# refugio-api

Backend de **Refugio**, la billetera virtual de Ancla Labs (Express + TypeScript + PostgreSQL + Firebase Auth).

## Documentación de la API (Swagger)

| Entorno    | Swagger UI                                                         | Spec JSON                                                               |
|------------|--------------------------------------------------------------------|-------------------------------------------------------------------------|
| Producción | https://refugio-api-production-1c49e3aa.up.railway.app/api-docs    | https://refugio-api-production-1c49e3aa.up.railway.app/api-docs.json    |
| Local      | http://localhost:3000/api-docs                                     | http://localhost:3000/api-docs.json                                     |

La spec está en `src/docs/openapi.ts`. **Si agregás o cambiás un endpoint, actualizá ese archivo en el mismo PR.**

### Probar endpoints protegidos

1. Obtener un ID token de Firebase:
   ```bash
   npm run token -- usuario@mail.com contraseña
   ```
   Necesita `FIREBASE_WEB_API_KEY` en el `.env`. Es la `apiKey` pública de la configuración web de Firebase, la misma que usa el frontend.
2. En Swagger, hacer clic en **Authorize**, pegar el token (sin `Bearer`) y confirmar.
3. Ejecutar `POST /auth/sync` y después cualquier otro endpoint.

## Endpoints

| Método | Ruta                          | Auth | Descripción                              |
|--------|-------------------------------|------|------------------------------------------|
| GET    | `/health`                     | No   | Estado del servicio                      |
| POST   | `/auth/sync`                  | Sí   | Crea o sincroniza el usuario y su billetera |
| GET    | `/me`                         | Sí   | Perfil del usuario autenticado           |
| PATCH  | `/me`                         | Sí   | Actualiza el nombre                      |
| GET    | `/users`                      | Sí   | Listado paginado con búsqueda            |
| GET    | `/wallet`                     | Sí   | Billetera con todos los saldos           |
| GET    | `/wallet/balances/{currency}` | Sí   | Saldo de una moneda                      |
| POST   | `/wallet/deposit`             | Sí   | Carga de dinero en ARS o USD             |
| GET    | `/rates`                      | No   | Cotizaciones actuales (USD/ARS, BTC/USD, USDT/USD) |
| GET    | `/rates/history`              | No   | Historial diario para el comparador      |

## Cotizaciones (caché)

- Fuentes: **DolarApi** (dólar oficial) y **CoinGecko** (BTC y USDT).
- El front consulta siempre a `GET /rates`; el back nunca llama a las APIs externas en cada pedido.
- Las cotizaciones se guardan en `exchange_rates` y se reutilizan durante `RATES_TTL_MINUTES` (10 por defecto). Al vencer, se vuelven a consultar.
- Cada actualización guarda el valor del día en `rate_history` (cierre diario), que alimenta `GET /rates/history`.
- Si una fuente falla, se devuelve la última cotización guardada con `stale: true`.
- Variable opcional `COINGECKO_API_KEY` (clave Demo gratuita) para no depender del límite compartido por IP.

## Desarrollo local

```bash
npm install
cp .env.example .env   # completar los valores
npm run dev
```
