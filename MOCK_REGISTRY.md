# Mock Registry

Все заглушки в проекте. При подключении реального провайдера — заменяешь соответствующий раздел.

---

## 1. Tofu — mock outputs вместо реальных ресурсов

**Файлы:**
- `templates/docker-host/tofu/main.tf`
- `templates/postgres/tofu/main.tf`

**Что заглушено:**
```hcl
output "public_ip" {
  value = "203.0.113.10"   # ← документация RFC 5737, не маршрутизируется
}
output "private_ip" {
  value = "10.0.0.10"
}
```

**Что нужно для реального провайдера:**

*Hetzner:*
```hcl
terraform {
  required_providers {
    hcloud = { source = "hetznercloud/hcloud", version = "~> 1.45" }
  }
}
provider "hcloud" { token = var.hcloud_token }

resource "hcloud_server" "node" {
  name        = var.name
  server_type = var.server_type
  location    = var.location
  image       = "ubuntu-24.04"
  ssh_keys    = [hcloud_ssh_key.deploy.id]
}

output "public_ip" { value = hcloud_server.node.ipv4_address }
```

*Oracle (Always Free):*
```hcl
terraform {
  required_providers {
    oci = { source = "oracle/oci", version = "~> 5.0" }
  }
}
# resource "oci_core_instance" "node" { ... }
```

**Secrets нужно добавить в GitHub:**
| Провайдер | Secret |
|---|---|
| Hetzner | `HCLOUD_TOKEN` |
| Oracle | `OCI_USER_OCID`, `OCI_TENANCY_OCID`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY` |
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (отдельные от R2) |
| Azure | `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_SUBSCRIPTION_ID`, `ARM_TENANT_ID` |
| GCP | `GOOGLE_CREDENTIALS` (JSON ключ сервисного аккаунта) |
| Yandex | `YC_TOKEN`, `YC_CLOUD_ID`, `YC_FOLDER_ID` |

---

## 2. Bootstrap — SSH скипается на mock IP

**Файл:** `.github/workflows/provision.yml`

**Что заглушено:**
```yaml
- name: Skip bootstrap (mock IP)
  if: steps.outputs.outputs.is_mock == 'true'
  # срабатывает если public_ip начинается с 203.0.113.
```

**Что происходит на mock:** в deployment events появляется `bootstrap_skipped`. Скрипты `bootstrap/base.sh` и `bootstrap/docker.sh` не запускаются.

**Что нужно для реального провайдера:**
1. Добавить SSH ключ в GitHub Secrets: `BOOTSTRAP_SSH_KEY` (приватный ключ, соответствующий публичному который кладётся на VM через cloud-init или провайдерский механизм)
2. При создании VM передавать публичный ключ через `user_data` / `cloud-init`
3. Mock detection убирать не нужно — она просто не сработает на реальном IP

---

## 3. Runtime actions — скипаются на mock IP

**Файл:** `.github/workflows/action.yml`

**Что заглушено:** та же логика — если `public_ip` начинается с `203.0.113.`, action помечается `skipped`.

**Затронутые actions:** `reboot`, `run_script`, `redeploy`

**Что нужно:** тот же `BOOTSTRAP_SSH_KEY` что и для bootstrap.

---

## 4. Node check-in — только ручной на mock

**Файл:** `bootstrap/checkin.sh`

**Что заглушено:** скрипт вызывается в `post_provision`, но до него не доходит на mock (bootstrap скипается).

**Как проверить вручную:**
```bash
curl -X POST https://YOUR_WORKER.workers.dev/api/nodes/checkin \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CALLBACK_TOKEN" \
  -d '{
    "environment_id": "ENV_ID",
    "hostname": "test-node",
    "public_ip": "REAL_IP",
    "agent_version": "0.1.0"
  }'
```

**Что нужно для реального провайдера:** ничего дополнительно — `checkin.sh` вызывается автоматически последним в `post_provision`.

---

## 5. Providers — нет реальных credentials

**Файлы:** `providers/*/provider.json`

Все провайдеры добавлены в UI и tofu принимает их переменные, но реальных API ключей нет.

**Статус подключения:**
| Провайдер | Tofu vars | Credentials | Реальный ресурс |
|---|---|---|---|
| hetzner | ✅ | ❌ | ❌ |
| oracle | ✅ | ❌ | ❌ |
| aws | ✅ | ❌ | ❌ |
| azure | ✅ | ❌ | ❌ |
| gcp | ✅ | ❌ | ❌ |
| yandex | ✅ | ❌ | ❌ |

---

## 6. Secrets нужные в GitHub и Cloudflare Workers

**GitHub Secrets (уже есть):**
- `CONTROL_PLANE_URL`
- `CALLBACK_TOKEN`
- `GITHUB_TOKEN` (PAT с правами `workflow`)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_ENDPOINT`

**GitHub Secrets (нужны для реального bootstrap):**
- `BOOTSTRAP_SSH_KEY`

**Cloudflare Workers secrets (wrangler secret put):**
- `GITHUB_TOKEN`
- `CALLBACK_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_WORKFLOW` — имя файла provision workflow
- `GITHUB_DESTROY_WORKFLOW` — имя файла destroy workflow
- `GITHUB_ACTION_WORKFLOW` — имя файла action workflow (`action.yml`)
- `GITHUB_REF` — ветка (`main`)

---

## Порядок подключения реального провайдера

1. Выбрать провайдера (рекомендуется начать с Hetzner — простейший API)
2. Заменить `main.tf` нужного шаблона на реальный
3. Добавить провайдерный secret в GitHub
4. Добавить SSH ключ `BOOTSTRAP_SSH_KEY`
5. Убедиться что VM создаётся с нужным публичным ключом
6. Создать environment через UI — наблюдать полный цикл включая bootstrap и checkin
