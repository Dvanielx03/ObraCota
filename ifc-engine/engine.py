"""HTTP routes of the IFC engine (H1-ESPECIFICACION §5.1). The logic lives in ``obracota_engine``.

/health and /inspect keep exactly the contract they had before H1: Compose's healthcheck, the
backend's HttpDoorInspection and design-change.spec.ts depend on it, and tests/test_inspect_contract.py
pins it. Their errors stay ``{"detail": ...}`` without ``code``. The pre-H1 /apply was retired in R4:
the backend publishes the verified artifact of /preview through /build instead.

The H1 routes answer errors as ``{"detail": ..., "code": ...}`` (§5.2). The reading ones (/summary,
/elements, /element) take every parameter as optional text and let ``reading`` validate it, so a missing
or malformed parameter is a 400 with ``code`` and not FastAPI's 422 list. /preview reads its body as any
JSON and lets ``recipe`` validate it the same way (only a body that is not JSON at all stays FastAPI's 422).

/preview with ``checks_only=true`` runs the checks of every operation on the cached model and writes
nothing. Without it, /preview builds and verifies the revision (``build``) and keeps the verified file as an
artifact for /build. /build sends that artifact once, or rebuilds it with the full verification. /diff
compares two stored versions. The size limit comes before anything is opened, in all three.

/dwg/solids answers the ACIS solids of a stored DWG as one gzip mesh (``obracota_engine.dwg``, format in
``dwg/meshfile.py``), cached on disk by the SHA-256 of the original and the tessellator version. An
``If-None-Match`` that names the current mesh is answered 304 without meshing.

Every request that writes uses its own ``TemporaryDirectory`` and removes it in every branch; only a
verified artifact survives, moved to ``ENGINE_ARTIFACTS`` first (§5.6). The engine empties
``ENGINE_ARTIFACTS`` when it starts (§5.9).
"""
import hashlib
import logging
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional
from uuid import UUID

from fastapi import Body, FastAPI, Header, HTTPException
from starlette.background import BackgroundTask
from starlette.responses import FileResponse, Response

from obracota_engine import artifacts, auth, build, errors, operations, reading, recipe, scope, settings, store
from obracota_engine.dwg import meshfile, solids as dwg_solids
from obracota_engine.errors import EngineError
# load and inspect stay importable from here: the step 0 capture of tests/fixtures/inspect-duplex.json
# calls engine.inspect(*engine.load(...)) and can be repeated against any image.
from obracota_engine.operations.change_type import inspect, load


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # The artifact index lives in memory: files of a previous process would never be evicted (§5.9).
    artifacts.reset()
    yield


app = FastAPI(lifespan=lifespan)
errors.install(app)
# Every route but /health needs the backend's token when ENGINE_TOKEN is set (R3).
app.add_middleware(auth.TokenGuard)
log = logging.getLogger(__name__)


@app.get("/health")
def health():
    return {"status": "UP"}


@app.get("/summary")
def model_summary(project: Optional[str] = None, version: Optional[str] = None, sha256: Optional[str] = None):
    return reading.summary(reading.version_ref(project, version, sha256))


@app.get("/elements")
def model_elements(project: Optional[str] = None, version: Optional[str] = None, sha256: Optional[str] = None,
                   ifc_class: Optional[str] = None, name: Optional[str] = None, storey: Optional[str] = None,
                   query: Optional[str] = None, limit: Optional[str] = None, cursor: Optional[str] = None):
    return reading.elements(reading.version_ref(project, version, sha256), ifc_class=ifc_class, name=name,
                            storey=storey, query=query, limit=limit, cursor=cursor)


@app.get("/element")
def model_element(project: Optional[str] = None, version: Optional[str] = None, sha256: Optional[str] = None,
                  guid: Optional[str] = None):
    return reading.element(reading.version_ref(project, version, sha256), guid)


@app.get("/dwg/solids")
def dwg_solids_mesh(project: Optional[str] = None, version: Optional[str] = None, sha256: Optional[str] = None,
                    if_none_match: Optional[str] = Header(None)):
    ref = reading.version_ref(project, version, sha256)
    if dwg_solids.not_modified(ref, if_none_match):
        # The caller holds the current mesh: no meshing and no cache read, even if it was evicted.
        return Response(status_code=304, headers={
            "ETag": dwg_solids.etag(ref.sha256), "X-ObraCota-Format": meshfile.FORMAT,
            "X-ObraCota-Source-Sha256": ref.sha256, "X-ObraCota-Tessellator": dwg_solids.tessellate.TESSELLATOR})
    result = dwg_solids.solids(ref)
    try:
        payload = result.path.read_bytes()
    except FileNotFoundError:
        # Evicted between the lookup and the read: compute it again.
        result = dwg_solids.solids(ref)
        payload = result.path.read_bytes()
    headers = {"ETag": result.etag, "X-ObraCota-Format": meshfile.FORMAT,
               "X-ObraCota-Source-Sha256": result.sha256,
               "X-ObraCota-Tessellator": dwg_solids.tessellate.TESSELLATOR,
               "X-ObraCota-Cache": "hit" if result.hit else "miss"}
    return Response(payload, media_type=meshfile.MEDIA_TYPE, headers=headers)


def _fits(ref) -> None:
    """The original exists with its SHA-256 and is not above ``ENGINE_PREVIEW_MAX_BYTES``: checked before
    anything is opened (§5.6)."""
    too_large = store.preview_limit_reason(store.require_original(ref.project, ref.version, ref.sha256))
    if too_large:
        raise EngineError(422, "MODEL_TOO_LARGE", too_large)


@app.post("/preview")
def preview(payload: Any = Body(None)):
    request = recipe.preview_request(payload)
    ref = request.ref
    _fits(ref)
    if request.checks_only:
        with store.models.reading(ref.project, ref.version, ref.sha256) as model, reading._model_errors():
            return operations.run_checks(model, request.recipe)
    with build.geometry_slot(settings.ENGINE_PREVIEW_WAIT_S), tempfile.TemporaryDirectory() as workdir:
        built = build.build_and_verify(ref, request.recipe, Path(workdir), build.Deadline())
        report = built.report
        if built.ok:
            meta = artifacts.put(built.output, ref.sha256, report["recipe_sha256"], built.sha256)
            report = {**report, "artifact": meta.public()}
            # The artifact goes right after recipe_sha256, as in §5.6.
            report = {key: report[key] for key in ("ok", "engine", "base", "recipe_sha256", "artifact")} | report
        return report


def _sha_of_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


@app.post("/build")
def build_revision(payload: Any = Body(None)):
    request = recipe.build_request(payload)
    ref = request.ref
    _fits(ref)
    recipe_sha = recipe.recipe_sha256(request.recipe)
    workdir = tempfile.TemporaryDirectory()
    try:
        output = Path(workdir.name) / "artifact.ifc"
        # The artifact path does not take the slot: it only reads a file that was already verified.
        meta = artifacts.take(request.artifact, ref.sha256, recipe_sha, output)
        if meta is not None and _sha_of_file(output) == meta.sha256:
            sha256, rebuilt = meta.sha256, False
        else:
            with build.geometry_slot():
                built = build.build_and_verify(ref, request.recipe, Path(workdir.name), build.Deadline())
            if not built.ok:
                raise EngineError(422, "VERIFICATION_FAILED", "La revisión no superó la verificación.",
                                  report=built.report)
            output, sha256, rebuilt = built.output, built.sha256, True
        headers = {"X-ObraCota-Output-Sha256": sha256, "X-ObraCota-Recipe-Sha256": recipe_sha,
                   "X-ObraCota-Rebuilt": "true" if rebuilt else "false"}
        return FileResponse(output, media_type="application/octet-stream", headers=headers,
                            background=BackgroundTask(workdir.cleanup))
    except BaseException:
        workdir.cleanup()
        raise


@app.post("/diff")
def diff_versions(payload: Any = Body(None)):
    request = recipe.diff_request(payload)
    for ref in (request.base, request.revision):
        _fits(ref)
    base, revision = request.base, request.revision
    with build.geometry_slot():
        deadline = build.Deadline()
        with store.models.lease(base.project, base.version, base.sha256) as old, reading._model_errors():
            if revision.sha256 == base.sha256:
                result = scope.diff(old.model, old.model, None)
            else:
                with store.models.lease(revision.project, revision.version, revision.sha256) as new:
                    result = scope.diff(old.model, new.model, None)
        deadline.check("diff")
        return result


@app.get("/inspect")
def inspect_door(project: UUID, version: UUID, element: str):
    try:
        return inspect(*load(project, version, element))
    except EngineError as exc:
        raise HTTPException(exc.status, exc.detail)
    except (RuntimeError, ValueError, AttributeError, IndexError) as exc:
        log.info("Incompatible IFC for inspection: %s", type(exc).__name__)
        raise HTTPException(422, "El IFC no contiene datos suficientes para revisar esta puerta.")

