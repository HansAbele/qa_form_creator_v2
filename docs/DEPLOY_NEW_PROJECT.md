# Guía: Desplegar un proyecto nuevo en el servidor compartido

> Servidor de producción de TNO: `192.168.80.243`
> 
> Esta guía aplica para cualquier proyecto nuevo que quiera subirse al mismo servidor donde ya corren **Qore** (qa-form-creator) y **Osiris Reporting**.

---

## Tabla de contenido

1. [Información del servidor](#1-información-del-servidor)
2. [Vista general del flujo](#2-vista-general-del-flujo)
3. [Puertos disponibles](#3-puertos-disponibles)
4. [Etapa 1: Pruebas locales](#4-etapa-1-pruebas-locales-antes-de-tocar-el-servidor)
5. [Etapa 2: Preparar archivos de producción](#5-etapa-2-preparar-archivos-de-producción)
6. [Etapa 3: Subir a GitHub](#6-etapa-3-subir-a-github)
7. [Etapa 4: Preparar el servidor](#7-etapa-4-preparar-el-servidor)
8. [Etapa 5: Primer arranque en producción](#8-etapa-5-primer-arranque-en-producción)
9. [Etapa 6: Actualizaciones futuras](#9-etapa-6-actualizaciones-futuras-día-a-día)
10. [Arquitectura con Backend](#10-arquitectura-con-backend)
11. [Consideraciones importantes](#11-consideraciones-importantes)
12. [Checklist pre-deploy](#12-checklist-pre-deploy)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Información del servidor

| Dato            | Valor                                  |
| --------------- | -------------------------------------- |
| **IP**          | `192.168.80.243`                       |
| **Usuario SSH** | `root` (pedir password al admin)       |
| **OS**          | Debian 12 (bookworm)                   |
| **Kernel**      | 6.1.0-44-amd64                         |
| **Tipo**        | VM QEMU/KVM (virtualizada en Proxmox)  |
| **CPU**         | 4 cores @ 2.0 GHz                      |
| **RAM**         | 3.8 GB                                 |
| **Disco**       | 30 GB (≈23 GB libres en estado limpio) |
| **Docker**      | 29.4.0 + BuildKit                      |

> ⚠️ **El disco es limitado.** Antes de subir verificar que el proyecto no requiera más de 5 GB de imágenes. Después de cada deploy, limpiar con `docker builder prune -a -f`.

### Proyectos que ya corren en el servidor

```
NAMES                   IMAGE                                   STATUS
qa_form_creator_app     qa-form-creator:latest                  Up (healthy)   ← Qore
qa_form_creator_db      postgres:16-alpine                      Up (healthy)   ← DB de Qore
osiris-reporting        osiris_reporting_app-osiris-reporting   Up (healthy)   ← Osiris
```

---

## 2. Vista general del flujo

```
[Local]                         [GitHub]                    [Servidor]
   │                               │                            │
   │ 1. Desarrollar + probar       │                            │
   │ 2. docker compose up -d       │                            │
   │ 3. Verificar que funciona     │                            │
   │                               │                            │
   │ 4. git push ─────────────────>│                            │
   │                               │                            │
   │                               │ 5. SSH al servidor         │
   │                               │ 6. git clone ─────────────>│
   │                               │ 7. crear .env.production   │
   │                               │ 8. docker compose up -d    │
   │                               │ 9. verificar health        │
```

---

## 3. Puertos disponibles

### Puertos actualmente ocupados

```
22     → SSH (sshd)
80     → Apache2 (HTTP)
443    → Apache2 (HTTPS)
3000   → Qore         (qa_form_creator_app, host 3000 → container 3000)
3001   → Osiris       (osiris-reporting, host 3001 → container 9001)
5432   → Postgres de Qore (solo interno, NO expuesto al host)
```

### Puerto sugerido para el siguiente proyecto: **`3002`**

Por consistencia con el patrón existente (`3000` = Qore, `3001` = Osiris, `3002` = nuevo).

**Otros puertos libres válidos:** `4000`, `5000`, `8000`, `8080`

### Verificar disponibilidad antes del deploy

```bash
ssh root@192.168.80.243 "ss -tlnp | grep LISTEN"
```

### Entender `HOST:CONTAINER`

```yaml
ports:
  - "3002:3000"
    │    │
    │    └─ Puerto DENTRO del contenedor (lo que la app escucha internamente)
    └────── Puerto DEL SERVIDOR/HOST (lo que los usuarios ven desde afuera)
```

**Regla clave:** solo el puerto **HOST** (izquierda) tiene que ser único. El puerto **CONTAINER** (derecha) puede repetirse entre proyectos sin problema — cada contenedor está en su propio namespace de red.

Los 3 proyectos podrían escuchar internamente en el puerto 3000:

```
qore:     3000:3000   ← interno 3000
osiris:   3001:3000   ← interno 3000 (NO choca con Qore)
nuevo:    3002:3000   ← interno 3000 (NO choca con nadie)
```

---

## 4. Etapa 1: Pruebas locales (antes de tocar el servidor)

> **Regla de oro:** nunca subir al servidor algo que no funciona en local.

### 4.1 Estructura mínima del proyecto

```
mi-proyecto/
├── Dockerfile                   # imagen de la app
├── docker-compose.yml           # para desarrollo local
├── docker-compose.prod.yml      # para producción (con restart policy)
├── .env.example                 # plantilla de variables SIN secretos
├── .env                         # desarrollo local (en .gitignore)
├── .env.production              # producción (en .gitignore)
├── .gitignore                   # DEBE incluir .env*
└── src/ (o app/, etc.)
```

### 4.2 Verificar que `.gitignore` excluye secretos

```bash
cat .gitignore
```

Debe contener al menos:

```
.env
.env.local
.env.production
node_modules/
__pycache__/
dist/
build/
*.log
.DS_Store
```

> ⚠️ Si `.env` no está en `.gitignore`, agregarlo AHORA y verificar que no haya sido commiteado antes con `git log -- .env`.

### 4.3 Build local y prueba

```bash
# Construir la imagen
docker compose build

# Levantar
docker compose up -d

# Verificar que está sano
docker ps
docker logs <nombre-contenedor> --tail 50

# Probar el endpoint principal
curl http://localhost:<puerto>/health
```

### 4.4 Pruebas de estrés mínimas

Antes de llevarlo a producción, verificar:

- [ ] Arranca sin errores desde cero (`docker compose down -v && docker compose up -d`)
- [ ] Sobrevive un reinicio del contenedor (`docker restart <contenedor>`)
- [ ] Los datos persisten si se apaga y se vuelve a prender (volúmenes correctos)
- [ ] Los logs se ven limpios (no hay errores recurrentes)

Si alguna falla → arreglar en local, **no subir** hasta que todo pase.

---

## 5. Etapa 2: Preparar archivos de producción

### 5.1 Plantilla de `docker-compose.prod.yml` (app simple)

```yaml
services:
  app:
    container_name: mi_proyecto_app       # ← nombre único en el servidor
    restart: unless-stopped               # ← CRÍTICO: auto-recovery si se cae
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${HOST_PORT:-3002}:3000"         # ← usa variable con default
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production                   # ← secretos fuera del código
    depends_on:
      - db
    networks:
      - default

  db:
    image: postgres:16-alpine
    container_name: mi_proyecto_db
    restart: unless-stopped
    environment:
      POSTGRES_USER: mi_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: mi_proyecto
    volumes:
      - pgdata:/var/lib/postgresql/data   # ← persistencia de datos
    # NO exponer puerto 5432 al host — solo la app lo usa
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mi_user -d mi_proyecto"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - default

volumes:
  pgdata:

networks:
  default:
    name: mi_proyecto_default             # ← red propia, aislada
```

### 5.2 Elementos críticos que no pueden faltar

| Línea                                     | Por qué                                           |
| ----------------------------------------- | ------------------------------------------------- |
| `restart: unless-stopped`                 | Auto-recupera si se cae o si reinicia el servidor |
| `container_name: mi_proyecto_xxx`         | Nombres únicos para no chocar con Qore/Osiris     |
| `env_file: .env.production`               | Los secretos NO van en docker-compose.yml         |
| `networks: { name: mi_proyecto_default }` | Red aislada — no interfiere con otros proyectos   |
| `volumes: pgdata:`                        | La DB persiste reinicios                          |
| `healthcheck:`                            | Docker sabe cuándo la DB está lista               |
| `${HOST_PORT:-3002}`                      | Puerto configurable por variable de entorno       |

### 5.3 `.env.production` (NO commitear)

```env
# Puerto en el host (servidor)
HOST_PORT=3002

# Secretos — generar valores reales, no copiar estos
DB_PASSWORD=<generar password fuerte>
API_KEY=<key real del servicio que uses>
SECRET_KEY=<otro secret fuerte>
```

**Generar passwords fuertes:**

```bash
# Bash / Git Bash
openssl rand -base64 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Python
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 5.4 `.env.example` (SÍ commitear — plantilla sin valores reales)

```env
HOST_PORT=3002
DB_PASSWORD=your-password-here
API_KEY=your-api-key-here
SECRET_KEY=your-secret-here
```

### 5.5 Dockerfile optimizado

**Ejemplo Node.js multi-stage:**

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Ejemplo Python/FastAPI:**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 6. Etapa 3: Subir a GitHub

```bash
# Local
git add .
git status                       # verificar que .env NO aparece
git commit -m "Initial production config: Dockerfile + docker-compose.prod.yml"
git push origin main
```

### Verificación crítica

Ir a GitHub en el navegador y abrir los archivos del repo. Buscar `.env*` — **NO debe aparecer**.

Si aparece:

```bash
# 1. Agregarlo al .gitignore
echo ".env.production" >> .gitignore

# 2. Borrarlo del historial
git rm --cached .env.production
git commit -m "Remove secrets"
git push

# 3. Rotar (cambiar) los secretos expuestos
```

---

## 7. Etapa 4: Preparar el servidor

### 7.1 Conectarse por SSH

```bash
ssh root@192.168.80.243
```

### 7.2 Verificar espacio en disco

```bash
df -h /
```

Debe haber al menos **5 GB libres** antes de clonar/build. Si hay menos:

```bash
docker builder prune -a -f
docker image prune -a -f
```

### 7.3 Crear carpeta del proyecto

```bash
cd /opt
mkdir mi-proyecto
cd mi-proyecto
```

### 7.4 Clonar desde GitHub

**Si el repo es público:**

```bash
git clone https://github.com/tu-usuario/mi-proyecto.git .
```

**Si el repo es privado — dos opciones:**

#### Opción A: Personal Access Token (más rápida)

1. GitHub → Settings → Developer settings → Personal access tokens → Generate new token (classic)
2. Marcar scope `repo`
3. Copiar el token

```bash
git clone https://<TOKEN>@github.com/tu-usuario/mi-proyecto.git .
```

#### Opción B: SSH Deploy Key (más segura, recomendada)

```bash
# Dentro del servidor
ssh-keygen -t ed25519 -C "deploy@server" -f ~/.ssh/mi_proyecto_deploy -N ""
cat ~/.ssh/mi_proyecto_deploy.pub
```

1. Copiar la llave pública que imprime
2. GitHub → tu repo → Settings → Deploy keys → Add deploy key
3. Pegar, dar nombre, **NO marcar write access** (solo lectura)

```bash
# Configurar git para usar la llave
cat >> ~/.ssh/config <<EOF
Host github.com-mi-proyecto
  Hostname github.com
  User git
  IdentityFile ~/.ssh/mi_proyecto_deploy
EOF

# Clonar con el host alias
git clone git@github.com-mi-proyecto:tu-usuario/mi-proyecto.git .
```

### 7.5 Crear `.env.production` en el servidor

```bash
nano /opt/mi-proyecto/.env.production
```

Pegar las variables con los valores **reales** de producción, guardar (`Ctrl+O`, Enter, `Ctrl+X`).

```bash
# Permisos: solo root puede leerlo
chmod 600 .env.production
```

---

## 8. Etapa 5: Primer arranque en producción

### 8.1 Build inicial

```bash
cd /opt/mi-proyecto
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

Puede tardar varios minutos la primera vez. Verificar que no haya errores.

### 8.2 Levantar los contenedores

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

### 8.3 Verificar que todo está sano

```bash
# Ver contenedores
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Ver logs de la app
docker logs mi_proyecto_app --tail 50

# Ver logs de la DB
docker logs mi_proyecto_db --tail 20

# Probar el endpoint desde adentro del servidor
curl http://localhost:3002/health
```

Debe mostrar algo como:

```
NAMES              STATUS                    PORTS
mi_proyecto_app    Up 30 seconds (healthy)   0.0.0.0:3002->3000/tcp
mi_proyecto_db     Up 35 seconds (healthy)   5432/tcp
```

### 8.4 Probar desde afuera (tu PC)

```bash
curl http://192.168.80.243:3002/health
```

Si responde → **el proyecto está en producción**.

Si no responde, volver al servidor y verificar:

```bash
# ¿El puerto está escuchando?
ss -tlnp | grep :3002

# ¿El firewall local bloquea?
iptables -L -n | head -30
```

---

## 9. Etapa 6: Actualizaciones futuras (día a día)

### Desarrollo normal

```
[Local] código → git commit → git push
```

### Desplegar cambios en el servidor

```bash
ssh root@192.168.80.243
cd /opt/mi-proyecto
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Downtime: ~10-30 segundos durante el restart del contenedor.

### Script de deploy automatizado

Crear `scripts/deploy.py` en el proyecto para automatizar:

```python
#!/usr/bin/env python3
"""deploy.py — update project on server"""
import paramiko

HOST = "192.168.80.243"
USER = "root"
PASS = "<password-ssh>"
PROJECT_DIR = "/opt/mi-proyecto"
COMPOSE_FILE = "docker-compose.prod.yml"
ENV_FILE = ".env.production"

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=15)

    cmd = (
        f"cd {PROJECT_DIR} && "
        "git pull && "
        f"docker compose -f {COMPOSE_FILE} --env-file {ENV_FILE} up -d --build 2>&1 | tail -30 && "
        "echo '--- containers ---' && "
        "docker ps --format 'table {{.Names}}\\t{{.Status}}' | grep mi_proyecto && "
        "echo '--- cleanup ---' && "
        "docker builder prune -a -f 2>&1 | tail -1 && "
        "docker image prune -a -f 2>&1 | tail -1 && "
        "df -h / | tail -1"
    )

    _, stdout, stderr = c.exec_command(cmd, timeout=600)
    for line in stdout:
        print(line.rstrip())
    err = stderr.read().decode()
    if err:
        print("STDERR:", err)
    c.close()

if __name__ == "__main__":
    main()
```

Correr desde local:

```bash
python scripts/deploy.py
```

> **Importante:** el script incluye `docker builder prune` + `docker image prune` al final, para que el disco no se llene con builds viejos. Cada deploy libera el cache del anterior.

---

## 10. Arquitectura con Backend

Si el proyecto tiene frontend + backend separados (no un monolito), seguir este patrón.

### 10.1 Concepto: 3 servicios en el mismo compose

```
                        INTERNET / LAN
                              │
                    ┌─────────▼──────────┐
                    │  PUERTO 3002       │  ← único expuesto al servidor
                    │  (Frontend)        │
                    └────────┬───────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │   RED INTERNA DE DOCKER (aislada)   │
          │                  │                  │
          ▼                  ▼                  ▼
     ┌──────────┐       ┌──────────┐      ┌──────────┐
     │ frontend │──────>│ backend  │─────>│    db    │
     │  :3000   │       │  :8000   │      │  :5432   │
     └──────────┘       └──────────┘      └──────────┘
```

- **Frontend** es el único que necesita puerto HOST (3002)
- **Backend** NO necesita puerto HOST — solo lo usa el frontend desde la red interna
- **DB** tampoco necesita puerto HOST — solo el backend habla con ella
- Los servicios se encuentran por **nombre de servicio** (DNS interno de Docker)

### 10.2 Plantilla completa: Frontend (Next.js) + Backend (FastAPI) + DB

```yaml
services:
  # ─── FRONTEND ─────────────────────────────────────
  frontend:
    container_name: mi_proyecto_frontend
    restart: unless-stopped
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "${HOST_PORT:-3002}:3000"         # ← único puerto expuesto
    environment:
      - BACKEND_URL=http://backend:8000   # ← nombre interno del servicio
      - NODE_ENV=production
    env_file:
      - .env.production
    depends_on:
      - backend
    networks:
      - default

  # ─── BACKEND ──────────────────────────────────────
  backend:
    container_name: mi_proyecto_backend
    restart: unless-stopped
    build:
      context: ./backend
      dockerfile: Dockerfile
    # NO hay "ports:" — backend NO se expone al servidor
    environment:
      - DATABASE_URL=postgresql://mi_user:${DB_PASSWORD}@db:5432/mi_proyecto
      - SECRET_KEY=${SECRET_KEY}
    env_file:
      - .env.production
    depends_on:
      db:
        condition: service_healthy
    networks:
      - default

  # ─── DATABASE ─────────────────────────────────────
  db:
    image: postgres:16-alpine
    container_name: mi_proyecto_db
    restart: unless-stopped
    environment:
      POSTGRES_USER: mi_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: mi_proyecto
    volumes:
      - pgdata:/var/lib/postgresql/data
    # NO hay "ports:" — DB solo accesible desde backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mi_user -d mi_proyecto"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - default

volumes:
  pgdata:

networks:
  default:
    name: mi_proyecto_default
```

### 10.3 Comunicación entre servicios

**Desde el frontend, llamar al backend:**

```javascript
// En código server-side del frontend (Next.js API route, etc.)
const response = await fetch("http://backend:8000/api/users");
//                              ^^^^^^^
//                              nombre del servicio, NO IP
```

**Desde el backend, conectar a la DB:**

```python
# Python
DATABASE_URL = "postgresql://mi_user:pass@db:5432/mi_proyecto"
#                                        ^^
#                                        nombre del servicio
```

### 10.4 Proxeo del navegador al backend (Next.js)

El navegador del usuario está **afuera** de la red Docker, no puede llamar a `http://backend:8000`. El frontend tiene que proxearlo.

**Opción A: Next.js rewrites** (`next.config.js`):

```javascript
module.exports = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL}/:path*`,
      },
    ];
  },
};
```

Cuando el navegador hace `fetch("/api/users")`:

1. Llega al frontend en puerto 3002
2. Next.js ve el rewrite y lo proxea a `http://backend:8000/users`
3. El backend responde
4. Next.js devuelve la respuesta al navegador

El navegador nunca sabe que existe un backend — cree que todo sale del frontend.

**Opción B: API routes propias del frontend:**

```javascript
// frontend/src/app/api/users/route.js
export async function GET() {
  const res = await fetch("http://backend:8000/users");
  return Response.json(await res.json());
}
```

### 10.5 ¿Cuándo exponer el backend también?

Agregar `ports: - "${BACKEND_PORT:-3003}:8000"` al backend **solo si:**

- App móvil consume la API directamente
- Integraciones de terceros (webhooks)
- Otro equipo/proyecto necesita acceso directo
- Debugging temporal

**Si expones el backend, necesitas CORS.** En FastAPI:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Y en `.env.production`:

```env
CORS_ORIGINS=http://192.168.80.243:3002,https://tu-dominio.com
```

### 10.6 Puertos: cuál necesita cada servicio

| Servicio     | ¿Necesita puerto HOST? | ¿Por qué?                                  |
| ------------ | ---------------------- | ------------------------------------------ |
| **Frontend** | Sí (ej. 3002)          | Los usuarios lo acceden desde el navegador |
| **Backend**  | Normalmente no         | Solo el frontend lo llama (red interna)    |
| **Database** | Casi nunca             | Solo el backend lo usa (red interna)       |

**Principio de mínimo privilegio:** cada puerto expuesto es una puerta más para un atacante. Exponer solo lo estrictamente necesario.

---

## 11. Consideraciones importantes

### 11.1 Nombres únicos

Todos los nombres deben ser únicos:

```yaml
# MAL: puede chocar con otros proyectos
container_name: app
networks: default

# BIEN: prefijo de proyecto
container_name: mi_proyecto_app
networks:
  default:
    name: mi_proyecto_default
```

### 11.2 NO exponer la DB al exterior

```yaml
# MAL: cualquiera en la red puede conectarse
db:
  ports:
    - "5432:5432"

# BIEN: solo accesible desde otros contenedores del mismo compose
db:
  # sin ports — la comunicación es interna
```

### 11.3 Limitar recursos (ser buen vecino)

El servidor tiene solo 3.8 GB de RAM y 4 CPUs compartidos entre 3+ proyectos:

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
```

### 11.4 Backups automáticos de la DB

Agregar al crontab del servidor:

```bash
crontab -e
```

Agregar:

```
0 2 * * * docker exec mi_proyecto_db pg_dump -U mi_user mi_proyecto | gzip > /opt/backups/mi_proyecto_$(date +\%F).sql.gz
0 3 * * 0 find /opt/backups -name "mi_proyecto_*.sql.gz" -mtime +30 -delete
```

Hace backup diario a las 2 AM, borra backups de más de 30 días los domingos.

### 11.5 Limpieza del disco después de cada deploy

Ya está en el script de deploy de la sección 9. Si hace build manual, no olvidarse de:

```bash
docker builder prune -a -f
docker image prune -a -f
```

### 11.6 Acceso desde fuera de la red local

La app será accesible solo desde la red `192.168.80.x`. Si necesita ser accesible desde internet:

- **Opción A:** Apache como reverse proxy (ya está corriendo en el servidor)
- **Opción B:** Abrir puerto en pfsense + NAT
- **Opción C:** Cloudflare Tunnel (sin abrir puertos)

Coordinar con el admin de red antes de tocar esto.

---

## 12. Checklist pre-deploy

### Local

- [ ] `docker compose up -d` arranca sin errores
- [ ] `docker compose down -v && up -d` también funciona (reset test)
- [ ] `curl` al endpoint principal devuelve 200
- [ ] `.env` NO está en git (verificado en github.com)
- [ ] `docker-compose.prod.yml` tiene `restart: unless-stopped`
- [ ] `docker-compose.prod.yml` tiene `container_name` único
- [ ] `docker-compose.prod.yml` tiene red con `name:` único
- [ ] `.env.example` existe (plantilla sin secretos)
- [ ] Dockerfile usa `--no-cache-dir` (Python) o `npm ci` (Node)
- [ ] Puerto escogido NO es 3000, 22, 80, 443

### Servidor

- [ ] `df -h` muestra > 5 GB libres
- [ ] `ss -tlnp` confirma que el puerto escogido está libre
- [ ] `/opt/mi-proyecto` existe y tiene el git clone
- [ ] `/opt/mi-proyecto/.env.production` existe con secretos reales
- [ ] `chmod 600 .env.production` aplicado
- [ ] `docker compose build` termina sin errores
- [ ] `docker compose up -d` levanta todo como healthy
- [ ] `curl http://localhost:<puerto>/health` devuelve 200 desde el server
- [ ] `curl http://192.168.80.243:<puerto>/health` devuelve 200 desde tu PC

---

## 13. Troubleshooting

### Contenedor no arranca

```bash
# Ver el error
docker logs mi_proyecto_app

# Ver en vivo
docker logs mi_proyecto_app -f

# Entrar al contenedor a debuggear
docker exec -it mi_proyecto_app sh
```

### Puerto en uso

```bash
# Ver qué está escuchando
ss -tlnp | grep :3002

# Liberar el puerto (si es un proceso viejo)
docker stop <contenedor-que-lo-usa>
```

### Build cachea algo roto

```bash
# Rebuildear sin cache
docker compose -f docker-compose.prod.yml build --no-cache
```

### Quiero empezar de cero (DATOS SE PIERDEN)

```bash
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d --build
```

### Un contenedor está unhealthy

```bash
# Ver el healthcheck
docker inspect mi_proyecto_app --format '{{json .State.Health}}'

# Reiniciarlo
docker restart mi_proyecto_app
```

### Ver recursos en uso

```bash
docker stats                              # en vivo
docker stats --no-stream                  # snapshot
docker system df                          # uso de disco de Docker
df -h /                                   # disco del servidor
```

### Ver logs de Docker a nivel sistema

```bash
journalctl -u docker --since "1 hour ago" --no-pager | tail -50
```

---

## Apéndice: Comandos de emergencia

### "Nada funciona, reiniciar todo"

```bash
cd /opt/mi-proyecto
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

### "Docker mismo no arranca"

```bash
systemctl status docker
systemctl restart docker
```

### "El disco está al 100%"

```bash
# Ver qué ocupa más
du -sh /var/lib/docker/* | sort -hr

# Limpiar (no toca volúmenes con datos)
docker builder prune -a -f
docker image prune -a -f
docker container prune -f
docker network prune -f
```

### "Necesito entrar a la DB a correr SQL"

```bash
# Shell interactivo psql
docker exec -it mi_proyecto_db psql -U mi_user -d mi_proyecto

# Query puntual
docker exec mi_proyecto_db psql -U mi_user -d mi_proyecto -c "SELECT COUNT(*) FROM users;"

# Ejecutar un archivo .sql
docker cp query.sql mi_proyecto_db:/tmp/query.sql
docker exec mi_proyecto_db psql -U mi_user -d mi_proyecto -f /tmp/query.sql
```

---

## Resumen en 10 pasos

```bash
# ── Local (una sola vez) ──────────────────────
1. Crear docker-compose.prod.yml con restart + nombres únicos + red con name
2. Crear .env.production (NO commitear, agregarlo al .gitignore)
3. docker compose up -d → probar → git push

# ── Servidor (primera vez) ────────────────────
4. ssh root@192.168.80.243
5. cd /opt && mkdir mi-proyecto && cd mi-proyecto
6. git clone <repo> .
7. nano .env.production → pegar secretos → chmod 600 .env.production
8. docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
9. curl http://localhost:<puerto>/health → verificar

# ── Servidor (deploys siguientes) ─────────────
10. git pull && docker compose up -d --build && docker builder prune -a -f
```
