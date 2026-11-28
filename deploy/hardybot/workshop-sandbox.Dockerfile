# Build from the existing reviewed analysis image; record its exact ID in the
# build receipt. Runtime permits package installation and network access.
ARG ANALYSIS_IMAGE=hardy-home-analysis:slice1
FROM ${ANALYSIS_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep build-essential patch diffutils ca-certificates sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip install --no-cache-dir --disable-pip-version-check pytest==8.4.2
COPY toolchain/node /usr/local/bin/node
COPY toolchain/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# Docker's injected init path must also exist when /usr is persisted separately.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && ln -s /usr/bin/tini /usr/sbin/docker-init
COPY reference /reference
COPY dependencies /opt/workshop-dependencies
RUN node --version && python --version && git --version && rg --version \
    && dpkg-query -W > /reference/os-packages.txt \
    && python -m pip freeze > /reference/python-packages.txt
USER root
WORKDIR /workspace
CMD ["sleep", "infinity"]
