#!/usr/bin/env bash
# Richtet auf dem CI-Runner (Ubuntu) die beiden nachgebauten Sicherungsziele ein:
#   Backup A: SFTP-Server auf Port 2222, Nutzer "probe"
#   Backup B: S3-Gateway (Versity) mit TLS auf Port 9000, Bucket mit Object Lock (Compliance, 1 Tag)
# Gibt die Umgebungsvariablen für run.sh in $GITHUB_ENV aus.
set -euo pipefail

work=${RUNNER_TEMP:-/tmp}/probe-targets
mkdir -p "$work/certs"

# PostgreSQL 17 und pgBackRest aus der offiziellen PGDG-Quelle, wie auf den Servern
sudo apt-get install -y -q postgresql-common openssh-server >/dev/null
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
sudo apt-get install -y -q postgresql-17 pgbackrest >/dev/null
pgbackrest version

# --- Backup A: SFTP ---
sudo useradd -m -s /bin/bash probe
sudo install -d -o probe -m 700 /home/probe/.ssh /home/probe/repo
ssh-keygen -q -t ed25519 -N '' -f "$work/probe_key"
sudo install -o probe -m 600 "$work/probe_key.pub" /home/probe/.ssh/authorized_keys
sudo mkdir -p /run/sshd
sudo /usr/sbin/sshd -p 2222 -o PasswordAuthentication=no

# --- Backup B: S3-Gateway mit TLS und Object Lock ---
# Versity Gateway, weil MinIO keine Container-Images mehr veröffentlicht.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout "$work/certs/private.key" -out "$work/certs/public.crt" 2>/dev/null
chmod 644 "$work/certs/private.key"
mkdir -p "$work/s3-data" "$work/s3-versions"
docker run -d --name s3 -p 9000:9000 \
  -e ROOT_ACCESS_KEY=probeadmin -e ROOT_SECRET_KEY=probe-secret-123 \
  -v "$work/certs:/certs:ro" -v "$work/s3-data:/data" -v "$work/s3-versions:/versions" \
  versity/versitygw:v1.9.0 \
  --port :9000 --cert /certs/public.crt --key /certs/private.key \
  posix --versioning-dir /versions /data >/dev/null
ready=0
for _ in $(seq 1 30); do
  if curl -ks -o /dev/null https://localhost:9000/; then ready=1; break; fi
  sleep 1
done
if ((ready == 0)); then
  docker logs s3 >&2
  echo "S3-Gateway startet nicht" >&2
  exit 1
fi

export AWS_ACCESS_KEY_ID=probeadmin AWS_SECRET_ACCESS_KEY=probe-secret-123 AWS_DEFAULT_REGION=us-east-1
s3() { aws --endpoint-url https://localhost:9000 --no-verify-ssl s3api "$@"; }
s3 create-bucket --bucket probe-b --object-lock-enabled-for-bucket >/dev/null
s3 put-object-lock-configuration --bucket probe-b --object-lock-configuration \
  '{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":1}}}'

{
  echo "PG_BIN=/usr/lib/postgresql/17/bin"
  echo "SFTP_HOST=localhost"
  echo "SFTP_PORT=2222"
  echo "SFTP_USER=probe"
  echo "SFTP_KEY=$work/probe_key"
  echo "SFTP_PATH=/home/probe/repo"
  echo "S3_ENDPOINT=localhost"
  echo "S3_PORT=9000"
  echo "S3_BUCKET=probe-b"
  echo "S3_REGION=us-east-1"
  echo "S3_KEY=probeadmin"
  echo "S3_SECRET=probe-secret-123"
  echo "PROBE_REQUIRE_S3=1"
} >>"${GITHUB_ENV:-/dev/stdout}"
