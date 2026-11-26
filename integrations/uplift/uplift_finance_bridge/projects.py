from .authority import PROJECT
from .errors import bounded_int, require, text
from .store import now


def project_list(store, principal, params):
    require(set(params) <= {"includeInactive"})
    require(type(params.get("includeInactive", False)) is bool)
    rows = store.connection.execute("SELECT code,name,active,revision FROM uplift_projects ORDER BY code").fetchall()
    return {"projects": [{"projectCode": row["code"], "name": row["name"], "active": bool(row["active"]), "revision": row["revision"]}
                         for row in rows if row["code"] in principal.project_codes and (row["active"] or params.get("includeInactive"))]}


def project_context(store, principal, params):
    require(set(params) == {"projectCode"})
    code = text(params["projectCode"], 64)
    principal.project(code)
    row = store.connection.execute("SELECT * FROM uplift_projects WHERE code=?", (code,)).fetchone()
    require(row is not None, "receipt_project_not_found", 404)
    return {"projectCode": code, "name": row["name"], "active": bool(row["active"]), "revision": row["revision"], "text": row["context_text"]}


def project_upsert(store, principal, params, operation_id):
    require(principal.can_manage_projects, "receipt_project_management_not_authorized", 403)
    require(set(params) == {"projectCode", "name", "context", "active", "expectedRevision"})
    code = text(params["projectCode"], 64)
    require(PROJECT.fullmatch(code) is not None)
    # Managing a catalog entry never grants access to the project itself.
    principal.project(code)
    name = text(params["name"], 250)
    body = text(params["context"], 16000)
    require(type(params["active"]) is bool)
    revision = bounded_int(params["expectedRevision"])
    def commit():
        previous = store.connection.execute("SELECT revision FROM uplift_projects WHERE code=?", (code,)).fetchone()
        require((previous[0] if previous else 0) == revision, "receipt_project_revision_conflict", 409)
        store.connection.execute("INSERT INTO uplift_projects(code,name,context_text,active,revision,updated_at,updated_by) VALUES (?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,context_text=excluded.context_text,active=excluded.active,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
                                 (code, name, body, int(params["active"]), revision+1, now(), principal.actor_id))
        return {"projectCode": code, "revision": revision+1, "active": params["active"], "grantChanged": False}
    return store.mutate(principal, "project.upsert", operation_id, params, commit, project_code=code)
