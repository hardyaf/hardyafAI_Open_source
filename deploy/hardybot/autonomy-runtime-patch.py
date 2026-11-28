#!/usr/bin/env python3
"""Exact overlays after the accepted V5/workshop runtime; caller owns writes."""
import hashlib,json,pathlib

def sha(body):return hashlib.sha256(body).hexdigest()
def rows(source,package='openclaw'):
    manifest=json.loads((pathlib.Path(source)/'deploy/hardybot/patches/autonomy-runtime.json').read_text())
    if manifest.get('nativeVersion')!='2026.9.8':raise RuntimeError('autonomy_native_version_mismatch')
    result=[row for row in manifest['files'] if row['package']==package]
    if len(result)!=(8 if package=='openclaw' else 2):raise RuntimeError('autonomy_manifest_incomplete')
    for row in result:
        p=pathlib.PurePosixPath(row['path'])
        if p.is_absolute() or '..' in p.parts or p.parts[0]!='dist' or p.suffix!='.mjs':raise RuntimeError('autonomy_manifest_path_invalid')
    return result

def payloads(runtime,source,package='openclaw'):
    runtime,source=pathlib.Path(runtime),pathlib.Path(source)
    if package=='openclaw' and json.loads((runtime/'package.json').read_text())['version']!='2026.9.8':raise RuntimeError('autonomy_native_version_mismatch')
    result={}
    for row in rows(source,package):
        p=runtime/row['path']
        if p.is_symlink():raise RuntimeError('autonomy_native_symlink')
        body=p.read_bytes();actual=sha(body)
        if actual==row['afterSha256']:result[row['path']]=body;continue
        if actual!=row['beforeSha256']:raise RuntimeError('autonomy_preimage_mismatch:'+row['path'])
        text=body.decode()
        for before,after in row['edits']:
            if text.count(before)!=1:raise RuntimeError('autonomy_anchor_mismatch')
            text=text.replace(before,after)
        body=text.encode()
        if sha(body)!=row['afterSha256']:raise RuntimeError('autonomy_payload_mismatch')
        result[row['path']]=body
    return result

def base_matches(runtime,source):
    """All original pins remain exact except explicitly chained overlay preimages."""
    runtime,source=pathlib.Path(runtime),pathlib.Path(source)
    overlay={row['path']:row for row in rows(source)}
    for manifest in ['native-context-budget.json','workshop-runtime.json']:
        base=json.loads((source/'deploy/hardybot/patches'/manifest).read_text())
        for row in base['files']:
            p=runtime/row['path'];actual=sha(p.read_bytes());expected=row['afterSha256'];change=overlay.get(row['path'])
            if change and change['beforeSha256']!=expected:return False
            if p.is_symlink() or actual not in ([expected,change['afterSha256']] if change else [expected]):return False
    return True

def installed(runtime,source,package='openclaw'):
    try:
        return (package!='openclaw' or base_matches(runtime,source)) and all(sha((pathlib.Path(runtime)/row['path']).read_bytes())==row['afterSha256'] for row in rows(source,package))
    except (OSError,ValueError,KeyError,RuntimeError):return False

def configure(config):
    """Remove configured work quotas; preserve serving, identity and all other config."""
    defaults=config.setdefault('agents',{}).setdefault('defaults',{})
    defaults['timeoutSeconds']=0
    defaults.setdefault('subagents',{}).update(maxConcurrent=0,maxChildrenPerAgent=0,maxSpawnDepth=0)
    tools=config.setdefault('tools',{});tools.setdefault('exec',{})['timeoutSeconds']=0
    tools.setdefault('web',{}).setdefault('fetch',{}).update(maxChars=0,maxCharsCap=0,maxResponseBytes=0)
    tools['web'].setdefault('search',{}).pop('maxResults',None)
    config.get('models',{}).get('providers',{}).get('ollama',{}).pop('timeoutSeconds',None)
    return config
