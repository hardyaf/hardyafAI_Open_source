import path from "node:path";

// Every operation runs in the existing native container namespace. No host file
// operation is available through this bridge, including for symlinks and root files.
const program=String.raw`import json,os,shutil,stat,sys
s=json.loads(sys.argv[1]);p=s["path"];op=s["op"]
if op=="read":
 with open(p,"rb") as f:sys.stdout.buffer.write(f.read(s.get("maxBytes",-1)))
elif op in ["write","create"]:
 if s.get("mkdir",True):os.makedirs(os.path.dirname(p),exist_ok=True)
 try:
  with open(p,"xb" if op=="create" else "wb") as f:f.write(sys.stdin.buffer.read())
  if op=="create":print("created")
 except FileExistsError:
  if op!="create":raise
  print("exists")
elif op=="mkdir":os.makedirs(p,exist_ok=True)
elif op=="stat":
 try:
  v=os.stat(p);print(json.dumps({"type":"file" if stat.S_ISREG(v.st_mode) else "directory" if stat.S_ISDIR(v.st_mode) else "other","size":v.st_size,"mtimeMs":v.st_mtime_ns/1000000}))
 except FileNotFoundError:print("null")
elif op=="realpath":print(os.path.realpath(p))
elif op=="list":print(json.dumps([{"name":e.name,"isDirectory":e.is_dir()} for e in os.scandir(p)]))
elif op=="copy":
 if s.get("mkdir",True):os.makedirs(os.path.dirname(s["to"]),exist_ok=True)
 shutil.copyfile(p,s["to"])
elif op=="rename":
 os.makedirs(os.path.dirname(s["to"]),exist_ok=True);os.replace(p,s["to"])
elif op=="remove":
 try:
  if os.path.isdir(p) and not os.path.islink(p):
   shutil.rmtree(p) if s.get("recursive") else os.rmdir(p)
  else:os.unlink(p)
 except FileNotFoundError:
  if not s.get("force"):raise
else:raise ValueError("unknown filesystem operation")
`;

export function createWorkshopFsBridge(sandbox,identitySymbol){
  const workspace=sandbox.containerWorkdir??"/workspace",hostRoot=path.resolve(sandbox.workspaceDir);
  const resolve=(params)=>{
    let file=params.filePath, cwd=params.cwd??workspace;
    if(typeof file!=="string"||file.includes("\0"))throw Error("Invalid workshop file path");
    const map=value=>value===hostRoot?workspace:value.startsWith(hostRoot+"/")?path.posix.join(workspace,value.slice(hostRoot.length+1)):value;
    file=map(file);cwd=map(cwd);
    return path.posix.resolve(cwd,file);
  };
  const invoke=async(op,params,extra={},stdin)=>{
    const result=await sandbox.backend.runShellCommand({script:'exec python3 -c "$1" "$2"',
      args:[program,JSON.stringify({op,path:resolve(params),...extra})],stdin,signal:params.signal,allowFailure:true});
    if(result.code!==0)throw Object.assign(Error(result.stderr.toString("utf8").trim()||"Workshop filesystem operation failed"),
      {code:result.stderr.toString("utf8").includes("FileNotFoundError")?"ENOENT":"EIO"});
    return result.stdout;
  };
  const bridge={
    resolvePath(params){const containerPath=resolve(params);return{containerPath,relativePath:path.posix.relative(workspace,containerPath)};},
    get pathMappings(){return[{hostRoot,containerRoot:workspace}];},
    readFile:params=>invoke("read",params,params.maxBytes===undefined?{}:{maxBytes:params.maxBytes}),
    writeFile:params=>invoke("write",params,{mkdir:params.mkdir!==false},Buffer.isBuffer(params.data)?params.data:Buffer.from(params.data,params.encoding??"utf8")).then(()=>{}),
    createFileExclusive:async params=>(await invoke("create",params,{mkdir:params.mkdir!==false},Buffer.isBuffer(params.data)?params.data:Buffer.from(params.data,params.encoding??"utf8"))).toString("utf8").trim(),
    mkdirp:params=>invoke("mkdir",params).then(()=>{}),
    stat:async params=>JSON.parse((await invoke("stat",params)).toString("utf8")),
    readDirectory:async params=>JSON.parse((await invoke("list",params)).toString("utf8")),
    remove:params=>invoke("remove",params,{recursive:params.recursive===true,force:params.force===true}).then(()=>{}),
    copyFile:params=>invoke("copy",{...params,filePath:params.sourcePath},{to:resolve({...params,filePath:params.destinationPath}),mkdir:params.mkdir!==false}).then(()=>{}),
    rename:params=>invoke("rename",{...params,filePath:params.from},{to:resolve({...params,filePath:params.to})}).then(()=>{}),
    async resolvePinnedMutationTarget(params){const canonical=(await invoke("realpath",params)).toString("utf8").trim();return{policyPath:canonical,pinnedPath:canonical};},
  };
  if(identitySymbol)bridge[identitySymbol]=async params=>"workshop:"+sandbox.containerName+":"+(await invoke("realpath",params)).toString("utf8").trim();
  return bridge;
}
