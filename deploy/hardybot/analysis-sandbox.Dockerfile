# Fixed dependencies are installed at image build, never by generated programs.
FROM python:3.12.12-slim-bookworm
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
      numpy==2.2.6 pandas==2.2.3 matplotlib==3.10.3 Pillow==11.2.1 \
    && groupadd --gid 1000 sandbox \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /bin/sh sandbox \
    && mkdir -p /workspace && chown 1000:1000 /workspace
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLCONFIGDIR=/tmp/matplotlib \
    HOME=/tmp
USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
