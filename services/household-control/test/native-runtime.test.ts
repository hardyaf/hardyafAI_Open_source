import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHouseholdRuntime} from '../../../plugins/household-domains/native-runtime.mjs';

function fixture(options:{createGate?:Promise<void>;initializationError?:Error;endGate?:Promise<void>;executeGates?:Record<string,Promise<void>>;completionOnly?:boolean}={}){
  const hooks=new Map<string,Function>(),services=new Map<string,{start:Function;stop:Function}>(),logs:string[]=[],calls:string[]=[];
  const contexts:Array<{completionRecovery?:boolean}>=[],guarded:string[]=[];
  let policy:{evaluate:Function},factory:{create:Function},created=0,closed=0,configured=0,executed=0;
  const descriptor={name:options.completionOnly?'task.complete':'lists.capture',nativeName:options.completionOnly?'household_task_complete':'household_lists_capture',description:'Fixture typed operation',inputSchema:{type:'object',properties:{}}};
  const runtime={isManagedAgent:()=>true,catalog:()=>[descriptor],configureNativeTransport(){configured++;},
    async admitNativeTurn(_event:unknown,context:{runId:string}){calls.push('admitted:'+context.runId);},
    async getTaskContext(context:{runId:string;completionRecovery?:boolean}){assert.ok(calls.includes('admitted:'+context.runId));contexts.push({...context});
      if(options.completionOnly&&context.completionRecovery!==true)throw Object.assign(Error('Closed source is completion-only'),{code:'admitted_household_request_required'});
      return {task:{assertCurrent(){}},assertCurrent(){}};},
    async executeNativeInvocation(_name:unknown,_args:unknown,context:{toolCallId:string}){executed++;await options.executeGates?.[context.toolCallId];return {delivered:true};},async bindNativeInvocation(){},async registerNativeChild(){},
    async taskPrompt(){return {prependSystemContext:'Owned conductor instructions',appendContext:'Scoped task data',toolsAllow:['household_lists_capture']};},
    async taskGuard(_binding:unknown,event:{toolName:string}){guarded.push(event.toolName);return {allow:true};},async taskFinalize(){return undefined;},bootstrapAccess:()=> 'unknown',async nativeEnd(_event:unknown,context:{runId:string}){
      if(context.runId==='run-a')await options.endGate;calls.push('settled');}};
  const api={id:'hardy-household',config:{plugins:{entries:{'hardy-household':{hooks:{allowConversationAccess:true,allowPromptInjection:true}}}}},pluginConfig:{controlEnvironmentPath:'/private/control.env',domainConfigurationPath:'/private/domains.json'},
    runtime:{config:{current:()=>({})}},logger:{error(value:string){logs.push(value);}},
    on(name:string,handler:Function){hooks.set(name,handler);},registerHook(){},registerTool(value:{create:Function}){factory=value;},
    registerTrustedToolPolicy(value:{evaluate:Function}){policy=value;},registerService(value:{id:string;start:Function;stop:Function}){services.set(value.id,value);},registerGatewayMethod(){}};
  registerHouseholdRuntime(api,{descriptors:[descriptor],async createOwned(){created++;await options.createGate;if(options.initializationError)throw options.initializationError;
    return {runtime,async close(){closed++;}};},async spawnNativeAnalysis(){throw Error('unexpected_spawn');},resolveSandboxRuntimeStatus(){throw Error('unexpected_sandbox_read');}});
  const context=(runId='run-a')=>({agentId:'main',sessionKey:'conversation-a',sessionId:'session-a',runId,assertInvocationCurrent(){},hookInvocation:{assertActive(){}}});
  return {hooks,services,logs,calls,contexts,guarded,context,policy:()=>policy!,factory:()=>factory!,counts:()=>({created,closed,configured,executed})};
}

test('actual worker registration initializes on hooks and executes typed tools without gateway service.start',async()=>{
  const f=fixture(),context=f.context();assert.equal(f.counts().created,0);
  // Tool metadata construction itself must remain free of runtime/credential IO.
  const tools=f.factory().create(context);assert.equal(tools.length,1);assert.equal(f.counts().created,0);
  await f.hooks.get('before_model_resolve')!({prompt:'Fixture action'},context);
  const prompt=await f.hooks.get('before_prompt_build')!({prompt:'Fixture action'},context);
  assert.equal(prompt.prependSystemContext,'Owned conductor instructions');assert.deepEqual(prompt.toolsAllow,['household_lists_capture']);
  assert.equal((await f.policy().evaluate({toolName:'household_lists_capture',params:{},toolCallId:'call-a',runId:'run-a'},context)).allow,true);
  await f.hooks.get('before_tool_call')!({toolName:'household_lists_capture',params:{},toolCallId:'call-a',runId:'run-a'},context);
  const result=await tools[0].execute('call-a',{});assert.equal(result.details.ok,true);
  assert.deepEqual(f.counts(),{created:1,closed:0,configured:1,executed:1});
  await f.hooks.get('agent_end')!({runId:'run-a'},context);
  assert.equal(f.counts().closed,1);assert.ok(f.calls.includes('settled'));
});

test('concurrent worker runs share one initializing owner and close only after both end',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const f=fixture({createGate:gate}),a=f.context('run-a'),b=f.context('run-b');
  const first=f.hooks.get('before_model_resolve')!({prompt:'First'},a),second=f.hooks.get('before_model_resolve')!({prompt:'Second'},b);
  release();await Promise.all([first,second]);assert.equal(f.counts().created,1);
  await f.hooks.get('agent_end')!({runId:'run-a'},a);assert.equal(f.counts().closed,0);
  await f.hooks.get('agent_end')!({runId:'run-b'},b);assert.equal(f.counts().closed,1);
});

test('worker initialization failure never counts as admission success or logs exception payloads',async()=>{
  const f=fixture({initializationError:Object.assign(Error('private-provider-payload'),{code:'private_secret_value'})}),context=f.context();
  await f.hooks.get('before_model_resolve')!({prompt:'Fixture action'},context);
  const prompt=await f.hooks.get('before_prompt_build')!({prompt:'Fixture action'},context);assert.deepEqual(prompt.toolsAllow,[]);
  assert.equal((await f.policy().evaluate({toolName:'household_lists_capture',params:{}},context)).allow,false);
  assert.equal(f.counts().executed,0);assert.equal(f.counts().created,1);
  assert.equal(f.logs.join('\n').includes('private-provider-payload'),false);
  assert.equal(f.logs.join('\n').includes('private_secret_value'),false);
  await f.hooks.get('agent_end')!({runId:'run-a'},context);
  assert.equal(f.calls.includes('settled'),false);
});

test('late asynchronous end of run A cannot dispose the owner already leased by run B',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const f=fixture({endGate:gate}),a=f.context('run-a'),b=f.context('run-b');
  await f.hooks.get('before_model_resolve')!({prompt:'First'},a);
  const endingA=f.hooks.get('agent_end')!({runId:'run-a'},a);
  await f.hooks.get('before_model_resolve')!({prompt:'Next run before old end completes'},b);
  release();await endingA;assert.equal(f.counts().created,1);assert.equal(f.counts().closed,0);
  assert.equal((await f.policy().evaluate({toolName:'household_lists_capture',params:{}},b)).allow,true);
  await f.hooks.get('agent_end')!({runId:'run-b'},b);assert.equal(f.counts().closed,1);
});

test('gateway service and worker hooks reuse one owner; service.stop closes and revokes it',async()=>{
  const f=fixture(),service=f.services.get('hardy-household-domain-resources')!,context=f.context();
  await service.start();await f.hooks.get('before_model_resolve')!({prompt:'Fixture'},context);
  assert.equal(f.counts().created,1);await f.hooks.get('agent_end')!({runId:'run-a'},context);assert.equal(f.counts().closed,0);
  await service.stop();assert.equal(f.counts().closed,1);
  assert.equal((await f.policy().evaluate({toolName:'household_lists_capture',params:{}},f.context('late-run'))).allow,false);
  assert.equal(f.counts().created,1);
});

test('discovery-only registry owner closes after its final call without an agent_end lease',async()=>{
  const f=fixture(),context=f.context();delete (context as {runId?:string}).runId;
  const [tool]=f.factory().create(context);assert.equal(f.counts().created,0);
  const result=await tool.execute('native-inner-call',{});assert.equal(result.details.ok,true);
  assert.deepEqual(f.counts(),{created:1,closed:1,configured:1,executed:1});
});

test('overlapping discovery call leases close only after the last invocation returns',async()=>{
  let releaseA!:()=>void,releaseB!:()=>void;
  const a=new Promise<void>(resolve=>{releaseA=resolve;}),b=new Promise<void>(resolve=>{releaseB=resolve;});
  const f=fixture({executeGates:{'call-a':a,'call-b':b}}),context=f.context();delete (context as {runId?:string}).runId;
  const [tool]=f.factory().create(context),first=tool.execute('call-a',{}),second=tool.execute('call-b',{});
  releaseA();await first;assert.equal(f.counts().created,1);assert.equal(f.counts().closed,0);
  releaseB();await second;assert.equal(f.counts().closed,1);assert.equal(f.counts().executed,2);
});

test('completion recovery context accepts only the exact direct or deferred completion target',async()=>{
  const allowed=[
    {toolName:'household_task_complete',params:{summary:'Verified result'}},
    {toolName:'tool_call',params:{id:'household_task_complete',args:{summary:'Verified result'}}},
    {toolName:'tool_call',params:{id:'openclaw:hardy-household:household_task_complete',args:{summary:'Verified result'}}},
  ];
  const denied=[
    {toolName:'tool_search',params:{query:'household_task_complete',completionRecovery:true}},
    {toolName:'tool_describe',params:{id:'household_task_complete',completionRecovery:true}},
    {toolName:'tool_call',params:{id:'household_lists_capture',args:{completionRecovery:true}}},
    {toolName:'tool_call',params:{id:'openclaw:another-plugin:household_task_complete',args:{}}},
    {toolName:'tool_call',params:{id:'openclaw:core:household_task_complete',args:{}}},
    {toolName:'tool_call',params:{id:'task.complete',args:{}}},
    {toolName:'tool_call',params:{args:{id:'household_task_complete'},completionRecovery:true}},
    {toolName:'tool_call',params:{id:'household_task_complete ',args:{}}},
    {toolName:'household_lists_capture',params:{completionRecovery:true}},
  ];
  for(const [expected,events] of [[true,allowed],[false,denied]] as const)for(const event of events){
    const f=fixture({completionOnly:true}),context={...f.context(),completionRecovery:true};
    try{
      await f.hooks.get('before_model_resolve')!({prompt:'Original admitted turn'},context);
      const result=await f.policy().evaluate({...event,toolCallId:'completion-call',runId:context.runId},context);
      assert.equal(result.allow,expected,JSON.stringify(event));
      assert.equal(f.contexts.at(-1)!.completionRecovery,expected,'Caller flags cannot override trusted target classification');
    }finally{await f.hooks.get('agent_end')!({runId:context.runId},context);}
  }
});

test('installed SDK outer dispatcher reaches completion recovery and still guards the inner call',{
  skip:!process.env.OPENCLAW_TEST_PACKAGE_ROOT&&'Set OPENCLAW_TEST_PACKAGE_ROOT for installed SDK policy verification',
},async()=>{
  const require=createRequire(path.join(process.env.OPENCLAW_TEST_PACKAGE_ROOT!,'package.json'));
  const {initializeGlobalHookRunner,resetGlobalHookRunner}=await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/hook-runtime')).href);
  const {wrapToolWithBeforeToolCallHook}=await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/agent-harness-runtime')).href);
  for(const selector of ['household_task_complete','openclaw:hardy-household:household_task_complete','openclaw:another-plugin:household_task_complete']){
    const f=fixture({completionOnly:true}),context=f.context();let outerExecutions=0;
    try{
      await f.hooks.get('before_model_resolve')!({prompt:'Original admitted turn'},context);
      initializeGlobalHookRunner({hooks:[],plugins:[],typedHooks:[],trustedToolPolicies:[{pluginId:'hardy-household',origin:'config',source:'fixture-completion-policy',policy:f.policy()}]});
      const [raw]=f.factory().create(context),inner=wrapToolWithBeforeToolCallHook(raw,context);
      // Real installed wrappers run both trusted policy calls. The small executor
      // supplies only dispatch, without replacing context projection or inner policy.
      const outer=wrapToolWithBeforeToolCallHook({name:'tool_call',label:'Tool Call',description:'Fixture exact dispatcher',
        parameters:{type:'object',properties:{id:{type:'string'},args:{type:'object'}},required:['id'],additionalProperties:false},
        async execute(_toolCallId:string,params:{id:string;args?:object}){outerExecutions++;return inner.execute('tool_call:outer:household_task_complete:1',params.args??{});}},context);
      const result=await outer.execute('outer-completion-call',{id:selector,args:{summary:'Verified result'}});
      if(selector.startsWith('openclaw:another-plugin:')){
        assert.equal(outerExecutions,0);assert.equal(f.counts().executed,0);assert.deepEqual(f.guarded,[]);
        assert.equal(f.contexts.at(-1)!.completionRecovery,false);
      }else{
        assert.equal(result.details.ok,true);assert.equal(outerExecutions,1);assert.equal(f.counts().executed,1);
        assert.deepEqual(f.guarded,['tool_call','household_task_complete']);
        assert.deepEqual(f.contexts.slice(-2).map(value=>value.completionRecovery),[true,true]);
      }
    }finally{resetGlobalHookRunner();await f.hooks.get('agent_end')!({runId:context.runId},context);}
  }
});
