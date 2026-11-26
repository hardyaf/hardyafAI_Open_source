import difflib
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("native_patch",pathlib.Path(__file__).with_name("apply-native-context-patch.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class NativePatchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="hardy-native-patch-test-")
        self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name)
        self.package=self.root/"package";(self.package/"dist").mkdir(parents=True)
        (self.package/"package.json").write_text(json.dumps({"name":"openclaw","version":"2026.9.8"}))
        self.original=b"export const value = 1;\n";self.updated=b"export const value = 2;\n"
        self.new=b"export const helper = true;\n"
        self.target=self.package/"dist/a.mjs";self.target.write_bytes(self.original);self.target.chmod(0o640)
        patch="".join(difflib.unified_diff(self.original.decode().splitlines(True),self.updated.decode().splitlines(True),fromfile="a/dist/a.mjs",tofile="b/dist/a.mjs"))
        patch+="".join(difflib.unified_diff([],self.new.decode().splitlines(True),fromfile="/dev/null",tofile="b/dist/helper.mjs"))
        self.patch=self.root/"reviewed.patch";self.patch.write_text(patch)
        self.manifest={"patchId":"context-budget-test","upstreamVersion":"2026.9.8","patchFile":self.patch.name,"patchSha256":module.digest(self.patch.read_bytes()),"files":[
            {"path":"dist/a.mjs","beforeSha256":module.digest(self.original),"afterSha256":module.digest(self.updated)},
            {"path":"dist/helper.mjs","beforeSha256":None,"afterSha256":module.digest(self.new)}]}
        self.path=self.root/"reviewed.json";self.save()
    def save(self):
        self.path.write_text(json.dumps(self.manifest))
    def run_patch(self,apply=False):
        return module.run(self.package,self.path,apply)
    def assert_original(self):
        self.assertEqual(self.target.read_bytes(),self.original)
        self.assertFalse((self.package/"dist/helper.mjs").exists())
    def test_replacement_stays_private_while_data_is_written(self):
        observed=[]
        original_fsync=os.fsync
        def inspect_fsync(descriptor):
            value=os.fstat(descriptor)
            if __import__("stat").S_ISREG(value.st_mode):
                observed.append(value.st_mode & 0o777)
            return original_fsync(descriptor)
        previous_umask=os.umask(0o022)
        try:
            with patch.object(module.os,"fsync",side_effect=inspect_fsync):
                module.atomic_write(self.target,self.updated,module.metadata(self.target))
        finally:
            os.umask(previous_umask)
        self.assertTrue(observed)
        self.assertEqual(observed[0],0o600)
        self.assertEqual(self.target.stat().st_mode & 0o777,0o640)
        self.assertEqual(self.target.read_bytes(),self.updated)
    def test_check_is_nonmutating(self):
        self.assertEqual(self.run_patch()["status"],"ready");self.assert_original()
    def test_apply_and_idempotence(self):
        self.assertEqual(self.run_patch(True)["writtenFiles"],2)
        self.assertEqual(self.target.read_bytes(),self.updated)
        self.assertEqual((self.package/"dist/helper.mjs").read_bytes(),self.new)
        self.assertEqual(self.target.stat().st_mode&0o777,0o640)
        self.assertEqual(self.run_patch(True)["status"],"already_applied")
    def test_breaks_shared_inode_without_mutating_other_install(self):
        other=self.root/"operator-original.mjs";os.link(self.target,other)
        self.run_patch(True)
        self.assertEqual(other.read_bytes(),self.original)
        self.assertNotEqual(other.stat().st_ino,self.target.stat().st_ino)
    def test_preserves_acl_and_extended_attributes(self):
        self.assertIsNotNone(shutil.which("setfacl"))
        os.setxattr(self.target,"user.hardy_patch_test",b"retained")
        subprocess.run(["setfacl","-m","u:65534:r",str(self.target)],check=True,capture_output=True)
        before=module.metadata(self.target)
        self.run_patch(True)
        self.assertEqual(module.metadata(self.target),before)
        self.assertIn("system.posix_acl_access",before["xattrs"])
    def test_later_write_failure_leaves_explicit_offline_recovery_state(self):
        original_write=module.atomic_write
        def fail_second(path,data,previous):
            if path.name=="helper.mjs":
                raise OSError("synthetic write failure")
            return original_write(path,data,previous)
        with patch.object(module,"atomic_write",side_effect=fail_second):
            with self.assertRaises(OSError):self.run_patch(True)
        self.assertEqual(self.target.read_bytes(),self.updated)
        self.assertFalse((self.package/"dist/helper.mjs").exists())
        with self.assertRaises(module.PatchError):self.run_patch(False)
    def test_unknown_source_hash_refuses_all_writes(self):
        self.target.write_bytes(b"changed\n")
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assertEqual(self.target.read_bytes(),b"changed\n")
        self.assertFalse((self.package/"dist/helper.mjs").exists())
    def test_bad_postimage_refuses_before_first_write(self):
        self.manifest["files"][1]["afterSha256"]="0"*64;self.save()
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assert_original()
    def test_patch_hash_refused(self):
        self.patch.write_text(self.patch.read_text()+"\n")
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assert_original()
    def test_mixed_package_requires_explicit_recovery(self):
        self.target.write_bytes(self.updated)
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assertEqual(self.target.read_bytes(),self.updated)
        self.assertFalse((self.package/"dist/helper.mjs").exists())
    def test_unsupported_version_refuses(self):
        (self.package/"package.json").write_text(json.dumps({"name":"openclaw","version":"2026.11.9"}))
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assert_original()
    def test_target_symlink_refuses(self):
        external=self.root/"outside.mjs";external.write_bytes(self.original)
        self.target.unlink();self.target.symlink_to(external)
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assertEqual(external.read_bytes(),self.original)
    def test_parent_escape_refuses(self):
        self.manifest["files"][1]["path"]="dist/../../outside.mjs";self.save()
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assert_original()
    def test_alternate_index_header_refuses(self):
        self.patch.write_text("Index: /etc/forbidden\n"+self.patch.read_text())
        self.manifest["patchSha256"]=module.digest(self.patch.read_bytes());self.save()
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assert_original()
    def test_git_header_must_match_reviewed_paths(self):
        self.patch.write_text("diff --git a/../../outside b/../../outside\n"+self.patch.read_text())
        self.manifest["patchSha256"]=module.digest(self.patch.read_bytes());self.save()
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assert_original()
    def test_duplicate_manifest_path_refuses(self):
        self.manifest["files"].append(self.manifest["files"][0]);self.save()
        with self.assertRaises(module.PatchError):self.run_patch(True)
        self.assert_original()

if __name__=="__main__":
    unittest.main()
