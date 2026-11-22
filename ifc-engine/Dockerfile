# IFC engine (H1-ESPECIFICACION §5.12). Three stages: base -> test -> runtime.
# runtime goes last, so a build without --target (and compose.yaml, which names it) gets the service.
#
#   docker build --target test -t obracota-ifc-engine:test ifc-engine     pytest, no network when run
#   docker build --target runtime -t obracota-ifc-engine:h1 ifc-engine    the service
#
# python:3.12-slim pinned by digest: the one obracota-ifc-engine:latest was built on (same four base
# layers, Python 3.12.16, Debian 13), read on 21-11-2026.
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b AS base
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY engine.py .
COPY obracota_engine/ obracota_engine/

FROM base AS test
COPY requirements-test.txt .
RUN pip install --no-cache-dir -r requirements-test.txt
COPY tests/ tests/
USER 10001
CMD ["python","-m","pytest","-q","-p","no:cacheprovider","tests"]

FROM base AS runtime
USER 10001
CMD ["uvicorn","engine:app","--host","0.0.0.0","--port","8000","--workers","1"]
