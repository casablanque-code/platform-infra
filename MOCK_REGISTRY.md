# Mock Registry

Все заглушки в проекте и статус реальных подключений. При подключении реального провайдера — следуй соответствующему разделу.

---

## Текущий статус провайдеров

| Провайдер | Tofu module | Реальный API | Bootstrap | Checkin |
|---|---|---|---|---|
| **ionos** | ✅ static IP | ✅ existing server | ✅ работает | ✅ работает |
| **mock** | ✅ gateway | ✅ infra-mock-gateway | ⏭ skipped | ⏭ skipped |
| hetzner | ⚠️ mock outputs | ❌ | ⏭ skipped | ⏭ skipped |
| oracle | ⚠️ mock outputs | ❌ | ⏭ skipped | ⏭ skipped |
| aws | ⚠️ mock outputs | ❌ | ⏭ skipped | ⏭ skipped |
| azure | ⚠️ mock outputs | ❌ | ⏭ skipped | ⏭ skipped |
| gcp | ⚠️ mock outputs | ❌ | ⏭ skipped | ⏭ skipped |
| yandex | ⚠️ mock outputs | ❌ | ⏭ skipped | ⏭ skipped |

---

## 1. Mock IP — bootstrap и actions скипаются

**Файлы:** `.github/workflows/provision.yml`, `.github/workflows/action.yml`

**Логика:**
```bash
if [ -z "$PUBLIC_IP" ] || echo "$PUBLIC_IP" | grep -q "^203\.0\.113\."; then
  IS_MOCK="true"
fi
```

`IS_MOCK=true` → bootstrap skipped, в events пишется `bootstrap_skipped`.
`IS_MOCK=false` → полный цикл: `base.sh` → `docker.sh` → `checkin.sh`.

Затрагивает все провайдеры кроме `ionos` (реальный `static_ip`) и `mock` (реальный IP от gateway).

**Что нужно для реального провайдера:**
- `BOOTSTRAP_SSH_KEY` в GitHub Secrets
- VM должна принимать ключ через cloud-init или провайдерский механизм
- Mock detection не нужно убирать — не сработает на реальном IP

---

## 2. Tofu modules

**Три режима работы:**

### Режим 1: static IP (IONOS — работает)
`providers/ionos/provider.json` передаёт `static_ip` → tofu возвращает его как `public_ip` output. Реальный VM не создаётся — используется существующий сервер.

### Режим 2: mock gateway (работает)
`providers/mock/provider.json` передаёт `gateway_url` + `environment_id`. Tofu делает POST на gateway, polling до `running`, destroy через `/v1/resources/delete`.

### Режим 3: реальный провайдер (WIP)

Пример для **Hetzner** (рекомендуется первым — cx22 ~€3/mo):
```hcl
terraform {
  required_providers {
    hcloud = { source = "hetznercloud/hcloud", version = "~> 1.45" }
  }
}

variable "hcloud_token" { sensitive = true }
provider "hcloud" { token = var.hcloud_token }

resource "hcloud_server" "node" {
  name        = "env-${var.environment_id}"
  server_type = var.server_type
  location    = var.location
  image       = "ubuntu-24.04"
  user_data   = <<-EOF
    #cloud-config
    ssh_authorized_keys:
      - ${tls_private_key.env_key.public_key_openssh}
  EOF
}

output "public_ip" { value = hcloud_server.node.ipv4_address }
```

**GitHub Secrets по провайдеру:**
| Провайдер | Secrets |
|---|---|
| Hetzner | `HCLOUD_TOKEN` |
| Oracle | `OCI_USER_OCID`, `OCI_TENANCY_OCID`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY` |
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (отдельные от R2) |
| Azure | `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_SUBSCRIPTION_ID`, `ARM_TENANT_ID` |
| GCP | `GOOGLE_CREDENTIALS` (JSON сервисного аккаунта) |
| Yandex | `YC_TOKEN`, `YC_CLOUD_ID`, `YC_FOLDER_ID` |

---

## 3. infra-mock-gateway

Go-сервер эмулирующий облачный provider API. Полный tofu lifecycle без реальных credentials.

**Запуск:**
```bash
cd infra-mock-gateway
go run main.go
# Dashboard: http://localhost:8080/dashboard
```

**Важно:** если запускаешь на VPS — открой порт до запуска bootstrap:
```bash
sudo ufw allow 8080/tcp comment 'Mock Gateway'
```
Bootstrap hardening (`base.sh`) закрывает все порты кроме 22. Если gateway на той же машине — открой 8080 заранее или после bootstrap вручную.

**Endpoints:**
| Endpoint | Method | Описание |
|---|---|---|
| `/v1/resources` | POST | Создать `{type, environment_id}` → `{id, ip, status: "creating"}` |
| `/v1/resources/:id` | GET | Poll → 503 creating / 200 running |
| `/v1/resources/delete` | POST | Удалить по `{id}` или `{environment_id}` |
| `/v1/health` | GET | Health check |
| `/dashboard` | GET | Web UI (live refresh) |

**Chaos headers (опционально):**
- `X-Chaos-Latency: true` — случайная задержка до 1.5s
- `X-Chaos-Failure: true` — 25% шанс 500

---

## 4. Node checkin — self-cleaning cron

**Файл:** `bootstrap/checkin.sh`

При первом запуске регистрирует ноду и устанавливает cron каждые 5 минут (`/usr/local/bin/platform-checkin.sh`).

**Self-cleanup:** перед каждым checkin скрипт проверяет существование environment через API. Если 404 — удаляет себя из cron и удаляет скрипт. Нода больше не появляется после destroy.

На mock IP checkin не выполняется (bootstrap скипается до него). Проверить вручную:
```bash
curl -X POST https://YOUR_WORKER.workers.dev/api/nodes/checkin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer CALLBACK_TOKEN" \
  -d '{"environment_id":"ENV_ID","hostname":"test","public_ip":"1.2.3.4","agent_version":"0.1.0"}'
```

---

## 5. Sensitive outputs — шифрование AES-GCM

**Файл:** `workers/control-plane/src/index.ts`

Следующие outputs шифруются перед записью в D1:
- `ssh_private_key`
- `db_password`
- `db_url`

Формат в D1: `enc:<iv_base64>:<ciphertext_base64>`

При чтении через `/api/environments/:id/outputs` расшифровываются прозрачно.

Требует `ENCRYPTION_KEY` в Wrangler secrets (`openssl rand -hex 32`). Старые незашифрованные значения читаются как есть (обратная совместимость).

---

## 6. Полный список secrets

### GitHub Actions secrets
| Secret | Описание |
|---|---|
| `CONTROL_PLANE_URL` | URL воркера |
| `CALLBACK_TOKEN` | Internal auth |
| `R2_ACCESS_KEY_ID` | R2 credentials |
| `R2_SECRET_ACCESS_KEY` | R2 credentials |
| `R2_BUCKET` | R2 bucket name |
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |
| `BOOTSTRAP_SSH_KEY` | ED25519 private key для SSH bootstrap |
| `TF_VAR_STATIC_IP` | IP существующего сервера (ionos) |
| `TF_VAR_GATEWAY_URL` | URL mock gateway |

### Cloudflare Workers secrets
| Secret | Описание |
|---|---|
| `GITHUB_TOKEN` | PAT с правами `repo`, `workflow` |
| `CALLBACK_TOKEN` | Internal auth (совпадает с GitHub) |
| `ADMIN_KEY` | Ключ для входа в дашборд как admin |
| `ENCRYPTION_KEY` | AES-256 ключ шифрования outputs |

> Все secrets устанавливаются автоматически через `bash setup.sh`

---

## 7. Порядок подключения реального провайдера

Рекомендуется начать с **Hetzner** — простейший API.

1. Получить API token: Hetzner Cloud Console → Security → API Tokens
2. Добавить в `platform.config.yml` под `providers.hetzner`
3. Написать `templates/docker-host/tofu/main.tf` с `hcloud_server` (пример выше)
4. Запустить `bash setup.sh` — установит `HCLOUD_TOKEN` в GitHub Secrets
5. Создать environment с провайдером `hetzner`
6. Наблюдать полный цикл: provision → bootstrap → checkin → auto-destroy
