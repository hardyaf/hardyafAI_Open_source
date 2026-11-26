from dataclasses import dataclass
import re

from .errors import ReceiptError, require, text

IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
PROJECT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
TRUSTED_EVIDENCE = {"local_ocr", "user_statement", "project_context", "standing_rule"}

# Shared read projection. Its predicate matches receipt_access, including all
# accepted/proposed project grants, so pagination never emits a private ID.
VISIBLE_RECEIPTS = """
SELECT r.* FROM uplift_receipts r
LEFT JOIN uplift_financial_entries f ON f.receipt_id=r.id
LEFT JOIN uplift_revisions v ON v.receipt_id=r.id AND v.revision=r.latest_revision
WHERE (
  (json_array_length(COALESCE(f.allocations_json,'[]')) +
   json_array_length(COALESCE(json_extract(v.candidate_json,'$.allocations'),'[]')) = 0
   AND r.owner_actor_id=:visibility_actor)
  OR (
   json_array_length(COALESCE(f.allocations_json,'[]')) +
   json_array_length(COALESCE(json_extract(v.candidate_json,'$.allocations'),'[]')) > 0
   AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(f.allocations_json,'[]')) a
     WHERE json_extract(a.value,'$.projectCode') NOT IN (SELECT value FROM json_each(:visibility_projects)))
   AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(v.candidate_json,'$.allocations'),'[]')) a
     WHERE json_extract(a.value,'$.projectCode') NOT IN (SELECT value FROM json_each(:visibility_projects)))
  )
)
"""


def visibility_parameters(principal):
    import json
    return {"visibility_actor": principal.actor_id, "visibility_projects": json.dumps(sorted(principal.project_codes))}


@dataclass(frozen=True)
class Principal:
    actor_id: str
    project_codes: frozenset
    can_manage_projects: bool
    can_review: bool
    evidence_origin: dict | None

    @classmethod
    def parse(cls, context):
        require(isinstance(context, dict), "receipt_context_required", 403)
        require(set(context) <= {"actorId", "projectCodes", "canManageProjects", "canReview", "evidenceOrigin"})
        actor = context.get("actorId")
        codes = context.get("projectCodes", [])
        require(isinstance(actor, str) and IDENTIFIER.fullmatch(actor), "receipt_context_required", 403)
        require(isinstance(codes, list) and len(codes) <= 1000 and all(isinstance(code, str) and PROJECT.fullmatch(code) for code in codes))
        for key in ["canManageProjects", "canReview"]:
            require(type(context.get(key, False)) is bool)
        origin = context.get("evidenceOrigin")
        if origin is not None:
            require(isinstance(origin, dict) and set(origin) <= {"kind", "sourceRef", "sourceSha256", "facts"})
            require(origin.get("kind") in TRUSTED_EVIDENCE, "receipt_evidence_origin_invalid", 403)
            text(origin.get("sourceRef"), 300)
            if origin.get("sourceSha256") is not None:
                require(isinstance(origin["sourceSha256"], str) and re.fullmatch(r"[a-f0-9]{64}", origin["sourceSha256"]))
            require(isinstance(origin.get("facts", {}), dict))
            if origin["kind"] in {"user_statement", "standing_rule"}:
                require(set(origin.get("facts", {})) <= {"vendor", "date", "currency", "totalMinor", "subtotalMinor", "amountMinor", "projectCode", "approvedException", "distinctReceiptIds", "interpretedFields", "clarification"})
        return cls(actor, frozenset(codes), context.get("canManageProjects", False), context.get("canReview", False), origin)

    def project(self, code):
        require(code in self.project_codes, "receipt_project_not_authorized", 403)


def receipt_access(connection, principal, receipt_id):
    row = connection.execute("SELECT * FROM uplift_receipts WHERE id=?", (receipt_id,)).fetchone()
    if row is None:
        raise ReceiptError("receipt_not_found", 404)
    import json
    project_codes = set()
    entry = connection.execute("SELECT allocations_json FROM uplift_financial_entries WHERE receipt_id=?", (receipt_id,)).fetchone()
    if entry:
        project_codes.update(item["projectCode"] for item in json.loads(entry[0]))
    latest = connection.execute("SELECT candidate_json FROM uplift_revisions WHERE receipt_id=? AND revision=?", (receipt_id, row["latest_revision"])).fetchone()
    if latest:
        project_codes.update(item["projectCode"] for item in json.loads(latest[0]).get("allocations", []))
    if project_codes:
        if project_codes <= principal.project_codes:
            return row
    elif row["owner_actor_id"] == principal.actor_id:
        return row
    raise ReceiptError("receipt_not_found", 404)
