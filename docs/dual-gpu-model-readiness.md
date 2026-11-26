# Dual-GPU and local model readiness

Updated November 26, 2026. **Two RTX 3090s are installed; bounded shared-model dual-GPU capacity and driver-health checks passed. Model replacement, semantic quality and mixed-workload acceptance remain open.** The current 27B Q4 model is unchanged. The model/registry assessment below is dated November 25 and was not refetched for this hardware check. Household web access is currently unavailable pending deferred LAN-address restoration; GPU readiness does not imply application readiness.

The next useful comparison is Qwen3.8 27B Q8_0 against the installed Q4_K_M, followed by Qwen3.6 35B-A3B Q8_0 as a throughput/quality alternative. Use the existing stock Ollama/OpenClaw path and one shared serving instance. Do not add a resource manager, independent model daemons or concurrent benchmark calls.

## Accepted plan and present evidence

[D22](design-decisions.md) authorized stronger-local Main evaluation, naming Qwen3.8 27B. The later Main-only promotion is recorded in the [worklog](WORKLOG.md); other profiles, credentials, permissions and fallback policy stayed unchanged. The earlier [acceptance record](acceptance.md) also planned a second RTX 3090 to relieve overlapping chat, 8B embedding and GPU OCR pressure. Those records do not identify an accepted specific successor above 27B. The current request brings the model step-up assessment into the dual-GPU work; the candidates below remain proposals.

The baseline is OpenClaw **2026.9.8 with the approved pinned V5 native compatibility patch**, Node **24.21.0**, Ollama **0.32.15**, and Main `ollama/qwen3.8:27b-q4_K_M` at **131,072 native working context and provider allocation**, with Main-only `thinkingDefault=high` mapping to native `think:"high"` and the installed Qwen renderer's **XHIGH** effort. Other profiles retain their previous GPT-OSS configuration, with no hosted or local fallback added. The descriptor advertises 2,048 output tokens; this is not evidence of an enforced provider output cap. The earlier November 26 64K probe used request-local `num_predict=64` for diagnostics and left production settings unchanged. The later 128K/high promotion changes only Main's context and reasoning defaults; production output options and compaction remain unchanged. See [operations](operations.md) and [measured model/runtime issues](model-runtime-known-issues.md).

Earlier fixed cases passed parent/child completion, literal list delivery, card capture/correction, and repaired private-memory correction. Earlier failures remain retained. These individual outcomes justify the existing pre-production choice, not a statistical accuracy claim or complete household acceptance.

The November 25 context investigation retained the original 18-read failure and the withheld global mid-turn-precheck candidate. A one-token 64K probe established memory fit only. Subsequent native working-budget, compaction and productive-follow-up acceptance is recorded separately in the [context investigation](native-context-precheck.md) and [repair record](context-budget-repair.md). The November 26 dual-GPU check does not replace those task-level results or establish a model-quality improvement.

## Reuse and ownership

| Responsibility | Existing authoritative owner | Applied serving state / next evaluation |
| --- | --- | --- |
| Downloaded weights, loaded runner and GPU allocations | One existing Ollama serving instance and its model volume | Shared dual-GPU placement and serial serving are applied; no second daemon or resource manager. |
| Selected model, context and provider request configuration | Protected OpenClaw configuration and the existing deployment/attestation process | Evaluate Main's selected Qwen model/context only; retain GPT profiles and other settings. |
| Identity, audiences, grants, canonical domain data and effects | Existing household admission/domain owners, stores and receipts | No new authority or duplicated data; model output cannot grant access or certify an effect. |
| Sessions, tool-loop compaction, children and continuation | Stock OpenClaw with the current native session/invocation bridge | Reuse native lifecycle and current-generation guards; no new queue, task engine or store. |

The selected Main Qwen native 64K workflow was accepted in the separately owned November 25 repair. The November 26 evidence below adds measured dual-GPU placement and bounded capacity. GPT profile configuration, domain authority and source V5 remain unchanged. Hardware installation does not rewrite other profiles into Qwen.

## November 26 Main 128K and maximum compatible reasoning

The protected and retained inputs now align the selected Qwen `contextTokens`, `contextWindow` and `params.num_ctx` at **131,072**, with Main-only high thinking. Other profiles retain their 32K settings. Live Gateway registry and actual deployed request serialization confirm the new context and `think:"high"`; this is separate from a model generation. PID/config attestation and the credential-isolation audit passed. The first immediate post-start observer failed and was retained under containment. A subsequent forward start waited for the listener and unchanged owner observer, then passed without any configuration rewrite; the exact earlier failure cause is unconfirmed.

Two isolated serial capacity requests at **131,072/high** both stopped normally with positive thinking and response output. All **66/66 layers** were offloaded, and API `size = size_vram = 26,241,841,230 bytes` (**24.440 GiB**). Peak sampled VRAM was **13,566 / 12,996 MiB**, with peak core temperatures **58 / 53 C**. No new AER, thermal-slowdown or kernel-fault evidence was found. The diagnostic requests used a local 2,048-token output setting; no production generation limit was added.

The prefill was only about **10.8K tokens**. These checks establish allocation, compatible effort, normal completion and bounded hardware health; they do not establish near-full 128K performance or semantic quality. Dated 64K compaction/continuation acceptance below remains valid for its tested workflows. Household web access remains unavailable while network restoration is deferred.

## Earlier November 26 hardware and 64K bounded capacity

Both **RTX 3090 24 GiB** cards are detected on driver **595.99.02** and kernel **7.0.0-44**. Each link reported **PCIe Gen4 x8** under load. One host runner was correlated to both physical devices, with **66/66 model layers offloaded**. Per-card layer counts were not logged.

| Measured item | Result |
| --- | --- |
| Backend model buffers | CUDA0 **7,252.61 MiB** (about 7.08 GiB); CUDA1 **7,835.71 MiB** (about 7.65 GiB) |
| Provider context / API allocation | **65,536**; `size = size_vram = 22,286,759,358 bytes` (20.756 GiB) |
| Peak sampled VRAM | **11,690 / 11,120 MiB** |
| Peak sampled GPU core temperature | **61 / 54 C** |
| GPU memory-junction temperatures | **Not available**; no zero-temperature inference |
| Cold request | **38.876 s** total; **23.698 s** load; **35.284 s** to first byte |
| Warm request | **10,781 prompt tokens**, **6.449 s** total; **2,205.73 prompt tokens/s**, **43.417 generated tokens/s** |

The API reports full GPU residency and all model layers are offloaded. A **682.03 MiB CPU_Mapped buffer** also exists; these observations do not mean that the process has zero host allocations. Before/after host checks and the bounded load showed no new AER or Xid errors, API mismatch, reset or fallen-off-GPU report, and no sampled thermal slowdown. This is not a long thermal soak or an OCR/embedding/concurrent-user acceptance result.

Exactly **two serial generation requests** were made. The second reached its diagnostic length limit and returned thinking only; it passed capacity/health gates, not semantic-answer or stop-reason quality gates. No thinking override, model download or production generation/profile change was made. Native work was idle afterward and protected source/configuration stayed unchanged.

The existing container had lost GPU-device access and returned an NVML unknown error. The existing shared service was recreated with **native CDI** and the applied flags below, preserving its pinned image/version, model digest, named model volume, `runc`, loopback-only port and all other configuration. The old container remains stopped and retained. Initial strict guards rejected Docker's `OomKillDisable` null/false representation normalization; those attempts and the independent exact postverification remain retained. No data or volume was deleted or restored.

NVIDIA documents a legacy-hook/cgroup GPU-access-loss failure mode and [CDI support](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/cdi-support.html). Its [NVML troubleshooting guidance](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/troubleshooting.html#containers-losing-access-to-gpus-with-error-failed-to-initialize-nvml-unknown-error) describes possible triggers. No particular daemon-reload event or original access-loss trigger was established for this host.

The native Gateway is operational, but household web services remain unavailable because the current LAN address does not match their existing binds/certificate/origin. The owner deferred router reservation/restoration. This work changed no address, bind, TLS, origin or household permissions.

## Installed artifact identity

The following installed-artifact identity and official-registry assessment was recorded on **November 25, 2026**. Candidate registry metadata was not refetched during the November 26 hardware check:

- `qwen3.8:27b-q4_K_M`: **17,741,872,132 bytes** locally; **27,320,697,856 language-model parameters**, Q4_K_M.
- GGUF `general.basename=Qwen3.8`, `general.architecture=qwen35`; advertised architectural context 262,144.
- Capabilities include completion, vision, tools and thinking.

On the November 25 review date, the official Ollama entry listed qwen35/27.3B/Q4_K_M. Qwen's card describes 3.8 as a dense model built on the 3.5 architectural foundation. The shared architecture field does not mean the weights are mislabeled 3.5. The published maximum context does not establish a tested local allocation. Pin the exact tag and digest; the unqualified `:27b` listing had a different digest in that review. [Exact installed tag](https://ollama.com/library/qwen3.8:27b-q4_K_M), [Qwen card](https://huggingface.co/Qwen/Qwen3.8-27B), [tag list](https://ollama.com/library/qwen3.8/tags).

## Proposed comparisons

| Option | Published artifact size | Purpose and limit |
| --- | --- | --- |
| Current Qwen3.8 27B Q4_K_M | About 18 GB | Retain as the control at the current 128K/high default; distinguish its bounded capacity proof from the separately accepted 64K task workflows. Spare device memory can also benefit embeddings/OCR. |
| [Qwen3.8 27B Q8_0](https://ollama.com/library/qwen3.8:27b-q8_0) | About 30 GB | First quality comparison: the same dense model family with less weight quantization. Better household outcomes remain to be measured; it is a precision step rather than a parameter-count increase. |
| [Qwen3.6 35B-A3B Q8_0](https://ollama.com/library/qwen3.6:35b-a3b-q8_0) | About 39 GB | Larger resident weights, with 35B total and 3B active parameters. Potentially lower per-token compute than dense 27B, but all expert weights still require storage. Treat it as an alternative, not an assured improvement over newer 3.8. |

The successor tags remain uninstalled and undownloaded. The November 26 check retained the existing 27B Q4 weights; the candidate sizes and assessment below are from November 25. The sizes are distribution artifacts, not total runtime VRAM. The 35B author's own agent results vary by benchmark and do not compare against this deployed 3.8 quantized runtime. [35B architecture and author results](https://huggingface.co/Qwen/Qwen3.6-35B-A3B). A [35B Q4_K_M artifact](https://ollama.com/library/qwen3.6:35b-a3b-q4_K_M), about 24 GB, is an optional lower-memory comparison if Q8 leaves insufficient mixed-workload headroom; label the architecture and quantization changes separately.

Public manifest SHA256 values, verified through the official registry's metadata endpoint on November 25, 2026:

| Exact tag | Manifest SHA256 |
| --- | --- |
| `qwen3.8:27b-q4_K_M` | `25b843619e944cd0ae6069f94ff4e5e26a16e109ccbc0a66a0f05979ed70098e` |
| `qwen3.8:27b-q8_0` | `8f5fb6b71ea00052cbe8545738c55ce61112c4e571cb60ca4dad00b131766039` |
| `qwen3.6:35b-a3b-q8_0` | `53003244b9b5f589be78818aaaa646fa242472f776f62ed0ccc224e6c29ee5e2` |

These hashes identify the published manifests, not a measured local runtime. Use the corresponding fixed tag; do not substitute `latest`, MTP, MLX or a similarly named quantization. [Q4 manifest](https://registry.ollama.ai/v2/library/qwen3.8/manifests/27b-q4_K_M), [27B Q8 manifest](https://registry.ollama.ai/v2/library/qwen3.8/manifests/27b-q8_0), [35B Q8 manifest](https://registry.ollama.ai/v2/library/qwen3.6/manifests/35b-a3b-q8_0).

## Capacity and larger-model limits

NVIDIA specifies 24 GB per RTX 3090. The installed pair provides nominal 48 GiB across separate devices; it is not one automatically unified allocation. Ollama documents fitting on one GPU by default and spreading a model that cannot fit. The current shared instance requests spread placement and the November 26 runner/buffer evidence confirms use of both cards. Raw VRAM does not imply doubled generation speed. [NVIDIA specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/rtx-3090-3090ti/), [Ollama loading behavior](https://docs.ollama.com/faq#how-does-ollama-load-models-on-multiple-gpus).

Budget separately for weights, KV cache, hybrid recurrent state, vision projector, compute buffers and embedding/OCR overlap. At 65,536 tokens, architecture-based FP16 KV illustrations are about 4 GiB for the full-attention portion of 3.8 27B and 1.25 GiB for 3.6 35B-A3B. These calculations use the attention-layer/head dimensions in the author cards and exclude other allocations; they are not measured VRAM requirements. Hybrid models should not be sized as though every layer uses full attention. [27B architecture](https://huggingface.co/Qwen/Qwen3.8-27B), [35B architecture](https://huggingface.co/Qwen/Qwen3.6-35B-A3B).

A dense 70B is outside the initial 64K shortlist. Llama3.3 Q4_K_M lists about 43 GB of weights; its published 80 layers, 8 KV heads and 128-dimensional keys/values imply another 20 GiB of FP16 KV at 64K, before overhead. Cache quantization or CPU spill changes that comparison and requires separate quality/latency evidence. Qwen3.8 BF16 lists 56 GB and Qwen3.5 122B Q4 lists 81 GB, exceeding the nominal two-card capacity before context. [70B weights](https://ollama.com/library/llama3.3:70b), [tensor metadata](https://ollama.com/library/llama3.3:70b/blobs/4824460d29f2), [3.8 tags](https://ollama.com/library/qwen3.8/tags), [122B tag](https://ollama.com/library/qwen3.5:122b).

Two current larger releases were also screened, without downloading weights:

| Larger candidate | Published artifact and identity | Assessment for two 24 GiB cards |
| --- | --- | --- |
| [GPT-OSS 120B](https://ollama.com/library/gpt-oss:120b) | About **65 GB**, manifest `714d86958b6e870a9320e78126ac1ce3477727a1cd9bf7194b8ace0d84c62fd8` | Published weights already exceed 48 GiB before cache/buffers; it is outside this fully-GPU shortlist. The November 25 official listing was 65 GB, not 63 GB. |
| [Qwen3.8-Flash-Next 125B-A6B Q4_K_M](https://ollama.com/library/qwen3.8-flash-next:125b-a6b-q4_K_M) | About **120 GB**, manifest `f79436a1cc83fd1a9b7752cf62247a2e7ad9fd7775c67230da4254fcc1d07f01` | The author specifies 125B core parameters with 6B active, plus 51B n-gram embeddings and 4B MTP. Sparse activation reduces compute, not the full weight allocation. Embedding offload does not establish a 48 GiB fit for the remaining core. This experimental architecture and its pinned-provider compatibility are unvalidated here. |

Flash-Next is a relevant newer capability candidate, not an omitted automatic successor: its author's improvements and larger memory/architecture requirements need their own supported evaluation. Its MLX NVFP4 tag is a different artifact, not a CUDA substitute for the named GGUF. No custom low-bit quantization, pruning or CPU-offload path is proposed by this initial plan. [Qwen author card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next), [Flash-Next tags](https://ollama.com/library/qwen3.8-flash-next/tags), [GPT-OSS manifest](https://registry.ollama.ai/v2/library/gpt-oss/manifests/120b), [Flash-Next manifest](https://registry.ollama.ai/v2/library/qwen3.8-flash-next/manifests/125b-a6b-q4_K_M).

Parallel requests multiply context allocation, and Ollama's cache quantization setting is global. Keep the existing single-request/cache baseline for the first comparison. Multi-user overlap or a cache experiment needs its own measured result. [Ollama concurrency/cache guidance](https://docs.ollama.com/faq).

## Applied shared-model serving configuration

On November 26, the following settings were applied to the **existing shared Ollama instance** and checked against the unchanged image/model-volume configuration:

```text
OLLAMA_SCHED_SPREAD=true
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_LOADED_MODELS=1
```

The pinned 0.32.15 source declares these settings; `SCHED_SPREAD` requests placement across available GPUs and `NUM_PARALLEL` controls simultaneous model requests. The measured runner/device allocation above supplies the placement evidence; environment values alone would not. [Pinned environment implementation](https://github.com/ollama/ollama/blob/v0.32.15/envconfig/config.go).

`MAX_LOADED_MODELS=1` is now the shared instance's resident-model policy. Embedding or retained GPT-profile calls can cause Main to unload and reload, adding latency. This does not provide separate agent/model/resource isolation, accepted parallel OCR/embedding capacity or an exclusive system-wide GPU reservation. A separate GPU consumer can still contend for memory or compute. Existing identity/tool permissions and native cancellation/resource safeguards remain intact; no arbitrary tool or turn caps were added.

## Further model and workload acceptance

1. Retain the November 26 hardware/container baseline and repeat the relevant health checks after hardware or driver changes. Keep one serving instance and the existing provider/session ownership.
2. Retain the current model as the control. Pin candidate digest, provider, prompt/tool/schema source, context, actual output request settings and cache policy. Change Main only, one candidate at a time, without concurrent comparison calls.
3. Measure full GPU residency, each card's peak use, CPU spill and prefill/first-token/generation latency during a real native long tool chain. Keep enough measured headroom for the intended embedding/OCR workload.
4. Reuse preserved synthetic cases for ordinary Gmail account selection, fresh/existing long chats, productive work after compaction, exact tool calls, parent/child continuation, literal lists and memory correction. Confirm current SID/run/source/owner/loaded-contract authority, honest results, revocation/cancellation and effect receipts. Do not use extra real mailbox access merely to benchmark a model.
5. Promote only a demonstrated task-quality/resource improvement at acceptable latency. Preserve identity, audience, credential isolation, grants, effect integrity, other profiles, no-fallback policy and disabled scheduling. Retain failures. Rollback restores captured model/descriptor/context settings; it never replaces newer business records, credentials or session history.
