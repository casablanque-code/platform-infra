#!/bin/bash
set -e

# Inject SSH public key from environment variable
if [ -n "$SSH_PUBLIC_KEY" ]; then
    echo "$SSH_PUBLIC_KEY" > /home/deploy/.ssh/authorized_keys
    chmod 600 /home/deploy/.ssh/authorized_keys
    chown deploy:deploy /home/deploy/.ssh/authorized_keys
    echo "[entrypoint] SSH public key injected"
else
    echo "[entrypoint] WARNING: SSH_PUBLIC_KEY not set — you won't be able to connect"
fi

# Generate host keys if missing
ssh-keygen -A

echo "[entrypoint] Starting sshd..."
exec /usr/sbin/sshd -D -e
