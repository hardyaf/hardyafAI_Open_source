#!/usr/bin/env python3
"""Populate a new lab from its reviewed image; never copy host system directories."""
import argparse
import pathlib
import posixpath
import subprocess
import tarfile


def populate(image, root):
    root = pathlib.Path(root).resolve(strict=True)
    system = root / "system"
    if system.exists() or (root / "reference").exists():
        raise RuntimeError("workshop_storage_already_populated")
    system.mkdir(mode=0o755)
    # Capture the clean image's actual native CDI namespace, including GPU userland
    # files that docker export omits. Never mount a host directory or credential.
    container = subprocess.check_output(["docker", "run", "-d", "--runtime=runc", "--gpus",
        "driver=cdi,device=nvidia.com/gpu=all", "--network", "none", "--entrypoint", "sleep", image, "infinity"], text=True).strip()
    try:
        process = subprocess.Popen(["docker", "exec", container, "tar", "-C", "/", "-cf", "-",
            "usr", "etc", "var", "opt", "tmp", "root", "reference"], stdout=subprocess.PIPE)
        try:
            with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
                for member in archive:
                    if member.isdev() or member.isfifo():
                        continue
                    # Preserve guest absolute symlink semantics without leaving absolute host links in staging.
                    if member.issym() and member.linkname.startswith("/"):
                        member = member.replace(linkname=posixpath.relpath(member.linkname.lstrip("/"), posixpath.dirname(member.name) or "."))
                    archive.extract(member, system, filter="data")
            if process.wait() != 0:
                raise RuntimeError("workshop_image_export_failed")
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.terminate()
                process.wait()
        if not all((system / name).is_dir() for name in ["usr", "etc", "var", "opt", "tmp", "root", "reference"]):
            raise RuntimeError("workshop_image_directories_missing")
        (system / "reference").rename(root / "reference")
    finally:
        subprocess.run(["docker", "rm", "-f", container], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    populate(args.image, args.root)
