FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    openssh-server \
    curl \
    wget \
    git \
    sudo \
    python3 \
    python3-pip \
    ca-certificates \
    gnupg \
    lsb-release \
    ufw \
    unzip \
    htop \
    && rm -rf /var/lib/apt/lists/*

# SSH setup
RUN mkdir -p /run/sshd

# Create deploy user (same as bootstrap scripts expect)
RUN useradd -m -s /bin/bash deploy && \
    echo "deploy ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# SSH key will be injected at runtime via environment variable
# See entrypoint.sh
RUN mkdir -p /home/deploy/.ssh && \
    chmod 700 /home/deploy/.ssh && \
    chown deploy:deploy /home/deploy/.ssh

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/entrypoint.sh"]
