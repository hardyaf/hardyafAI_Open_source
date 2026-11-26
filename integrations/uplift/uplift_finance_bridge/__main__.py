"""One bounded request per process. No tools receive paths, clients or secrets."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys

from .authority import Principal
from .candidates import candidate_accept, candidate_get, candidate_save, candidate_validate, duplicates, receipt_get
from .errors import ReceiptError, require
from .projects import project_context, project_list, project_upsert
from .reports import operation_get, receipt_list, report_generate
from .review import attempt_record, receipt_dispute, receipt_exclude, review_get, review_list, review_respond
from .sources import evidence_add, evidence_list, evidence_read, intake, source_get
from .store import Store

READ = {"project.list": project_list, "project.context": project_context,
        "receipt.list": receipt_list, "receipt.get": receipt_get, "source.get": source_get,
        "evidence.list": evidence_list, "evidence.read": evidence_read,
        "candidate.get": candidate_get, "candidate.validate": candidate_validate, "duplicate.find": duplicates,
        "review.list": review_list, "review.get": review_get, "report.generate": report_generate, "operation.get": operation_get}
WRITE = {"source.intake": intake, "project.upsert": project_upsert, "candidate.save": candidate_save,
         "candidate.accept": candidate_accept, "receipt.exclude": receipt_exclude, "receipt.dispute": receipt_dispute,
         "attempt.record": attempt_record, "review.respond": review_respond,
         "evidence.add": evidence_add,
         "evidence.record": lambda store, principal, params, operation: evidence_add(store, principal, params, operation, trusted=True)}


def invoke(store, packet):
    require(isinstance(packet, dict) and set(packet) <= {"version", "operation", "params", "context", "operationId"})
    require(packet.get("version") == 1 and type(packet.get("version")) is int)
    operation = packet.get("operation")
    require(operation in READ or operation in WRITE, "receipt_operation_unsupported", 404)
    params = packet.get("params", {})
    require(isinstance(params, dict))
    principal = Principal.parse(packet.get("context"))
    if operation in WRITE:
        return WRITE[operation](store, principal, params, packet.get("operationId"))
    require("operationId" not in packet, "receipt_read_operation_id_unexpected")
    store.connection.execute("BEGIN")
    try:
        result = READ[operation](store, principal, params)
        store.connection.commit()
        return result
    except BaseException:
        store.connection.rollback()
        raise


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--init", action="store_true")
    mode.add_argument("--readiness", action="store_true")
    mode.add_argument("--describe", action="store_true")
    args = parser.parse_args()
    store = None
    try:
        if args.describe:
            result = json.loads((Path(__file__).resolve().parents[1]/"operations.json").read_text())
        else:
            require(os.environ.get("UPLIFT_DATABASE") and os.environ.get("UPLIFT_VAULT_ROOT"), "uplift_not_configured", 503)
            store = Store(os.environ["UPLIFT_DATABASE"], os.environ["UPLIFT_VAULT_ROOT"])
            if args.init:
                result = store.initialize()
            else:
                store.open_existing()
                if args.readiness:
                    result = store.readiness()
                else:
                    body = sys.stdin.buffer.read(36*1024*1024+1)
                    require(0 < len(body) <= 36*1024*1024, "receipt_request_size_invalid", 413)
                    packet = json.loads(body.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                    result = invoke(store, packet)
        response = {"version": 1, "ok": True, "result": result}
    except ReceiptError as error:
        response = {"version": 1, "ok": False, "error": {"code": error.code, "status": error.status}}
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        response = {"version": 1, "ok": False, "error": {"code": "receipt_request_invalid", "status": 400}}
    except (OSError, sqlite3.Error):
        response = {"version": 1, "ok": False, "error": {"code": "uplift_storage_unavailable", "status": 503}}
    except Exception:
        # Never echo exceptions, provider text, filesystem paths or input content.
        response = {"version": 1, "ok": False, "error": {"code": "uplift_internal_error", "status": 500}}
    finally:
        if store is not None:
            store.close()
    rendered = json.dumps(response, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    if len(rendered.encode("utf-8")) > 4*1024*1024:
        response = {"version": 1, "ok": False, "error": {"code": "uplift_result_too_large", "status": 413}}
        rendered = json.dumps(response, separators=(",", ":"))
    sys.stdout.write(rendered+"\n")
    return 0 if response["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
