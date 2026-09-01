FROM debian:bookworm-slim AS build
ARG ASTERISK_VERSION=22.11.0
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl file git pkg-config python3 \
    libcurl4-openssl-dev libedit-dev libjansson-dev libnewt-dev \
    libsqlite3-dev libssl-dev libxml2-dev libncurses-dev uuid-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSLO "https://downloads.asterisk.org/pub/telephony/asterisk/releases/asterisk-${ASTERISK_VERSION}.tar.gz" \
    && curl -fsSLO "https://downloads.asterisk.org/pub/telephony/asterisk/releases/asterisk-${ASTERISK_VERSION}.sha256" \
    && sha256sum -c "asterisk-${ASTERISK_VERSION}.sha256" \
    && tar -xzf "asterisk-${ASTERISK_VERSION}.tar.gz"
WORKDIR /src/asterisk-${ASTERISK_VERSION}
RUN ./configure --with-jansson-bundled --with-pjproject-bundled \
    && make menuselect.makeopts \
    && menuselect/menuselect --disable BUILD_NATIVE menuselect.makeopts \
    && make -j"$(nproc)" \
    && make DESTDIR=/opt/asterisk-root install \
    && rm -rf /opt/asterisk-root/var/run

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libcurl4 libedit2 libjansson4 libsqlite3-0 \
    libssl3 libxml2 libncurses6 libuuid1 \
    && groupadd --system asterisk \
    && useradd --system --gid asterisk --home-dir /var/lib/asterisk asterisk \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/asterisk-root/ /
COPY config/ /etc/asterisk/
COPY scripts/healthcheck.sh /usr/local/bin/asterisk-healthcheck
RUN chmod 0555 /usr/local/bin/asterisk-healthcheck \
    && mkdir -p /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/run/asterisk \
    && chown -R asterisk:asterisk /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/run/asterisk \
    && chmod -R go-w /etc/asterisk
USER asterisk
EXPOSE 5060/tcp 5060/udp 8088/tcp 12000-12100/udp
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 CMD ["asterisk-healthcheck"]
CMD ["asterisk", "-f", "-U", "asterisk", "-G", "asterisk", "-vvv"]
