# Dual-GPU and local model readiness

Reviewed November 25, 2026. **Proposed evaluation direction; no model replacement or dual-GPU acceptance is claimed.** The second RTX 3090 is not installed. The owner confirms the PSU was sized for the pair; cabling, cooling and physical fit remain to be checked. The [current status](current-status.md) owns subsequent deployment and long-context results.

The next useful comparison is Qwen3.8 27B Q8_0 against the installed Q4_K_M, followed by Qwen3.6 35B-A3B Q8_0 as a throughput/quality alternative. Use the existing stock Ollama/OpenClaw path and one shared serving instance. Do not add a resource manager, independent model daemons or concurrent benchmark calls.

## Accepted plan and present evidence

[D22](design-decisions.md) authorized stronger-local Main evaluation, naming Qwen3.8 27B. The later Main-only promotion is recorded in the [worklog](WORKLOG.md); other profiles, credentials, permissions and fallback policy stayed unchanged. The earlier [acceptance record](acceptance.md) also planned a second RTX 3090 to relieve overlapping chat, 8B embedding and GPU OCR pressure. Those records do not identify an accepted specific successor above 27B. The current request brings the model step-up assessment into the dual-GPU work; the candidates below remain proposals.

The baseline is stock OpenClaw **2026.9.8**, Node **24.21.0**, Ollama **0.32.15**, and Main `ollama/qwen3.8:27b-q4_K_M` at **65,536 context** after the separately recorded configuration promotion. Other profiles retain their previous GPT-OSS configuration, with no hosted or local fallback added. The descriptor advertises 2,048 output tokens; failed historical requests did not establish the effective output cap. Preserve the actual configured request settings during comparisons. See [operations](operations.md) and [measured model/runtime issues](model-runtime-known-issues.md).

Earlier fixed cases passed parent/child completion, literal list delivery, card capture/correction, and repaired private-memory correction. Earlier failures remain retained. These individual outcomes justify the existing pre-production choice, not a statistical accuracy claim or complete household acceptance.

The recent long-email failure followed 18 successful connected reads and exceeded the configured 32K context. The global mid-turn-precheck candidate was withheld after a fresh-chat regression, despite an existing-chat lifecycle pass. The earlier one-token 64K probe used 20,988 MiB and established GPU memory fit only. The separate native 64K workflow validation is recorded by the [context investigation](native-context-precheck.md) and current status; it must not be inferred from the fit probe. The subsequent context promotion is separately recorded there; no model replacement occurred.

## Reuse and ownership

| Responsibility | Existing authoritative owner | Planned change |
| --- | --- | --- |
| Downloaded weights, loaded runner and GPU allocations | One existing Ollama serving instance and its model volume | Reuse its supported placement/concurrency settings; no second daemon or resource manager. |
| Selected model, context and provider request configuration | Protected OpenClaw configuration and the existing deployment/attestation process | Evaluate Main's selected Qwen model/context only; retain GPT profiles and other settings. |
| Identity, audiences, grants, canonical domain data and effects | Existing household admission/domain owners, stores and receipts | No new authority or duplicated data; model output cannot grant access or certify an effect. |
| Sessions, tool-loop compaction, children and continuation | Stock OpenClaw with the current native session/invocation bridge | Reuse native lifecycle and current-generation guards; no new queue, task engine or store. |

The selected Main Qwen 64K workflow remains pending its separately owned verification and promotion decision at this checkpoint. GPT profile configuration is unchanged. Neither hardware installation nor this plan rewrites other profiles into Qwen.

## Installed artifact identity

Read-only local metadata and the official registry agree on the exact installed tag and manifest:

- `qwen3.8:27b-q4_K_M`: **17,741,872,132 bytes** locally; **27,320,697,856 language-model parameters**, Q4_K_M.
- GGUF `general.basename=Qwen3.8`, `general.architecture=qwen35`; advertised architectural context 262,144.
- Capabilities include completion, vision, tools and thinking.

The official Ollama entry lists qwen35/27.3B/Q4_K_M. Qwen's card describes 3.8 as a dense model built on the 3.5 architectural foundation. The shared architecture field does not mean the weights are mislabeled 3.5. The published maximum context does not establish a tested local allocation. Pin the exact tag and digest; the unqualified `:27b` listing currently has a different digest. [Exact installed tag](https://ollama.com/library/qwen3.8:27b-q4_K_M), [Qwen card](https://huggingface.co/Qwen/Qwen3.8-27B), [tag list](https://ollama.com/library/qwen3.8/tags).

## Proposed comparisons

| Option | Published artifact size | Purpose and limit |
| --- | --- | --- |
| Current Qwen3.8 27B Q4_K_M | About 18 GB | Retain as the control at the existing context and separately validated 64K setting. Spare device memory can also benefit embeddings/OCR. |
| [Qwen3.8 27B Q8_0](https://ollama.com/library/qwen3.8:27b-q8_0) | About 30 GB | First quality comparison: the same dense model family with less weight quantization. Better household outcomes remain to be measured; it is a precision step rather than a parameter-count increase. |
| [Qwen3.6 35B-A3B Q8_0](https://ollama.com/library/qwen3.6:35b-a3b-q8_0) | About 39 GB | Larger resident weights, with 35B total and 3B active parameters. Potentially lower per-token compute than dense 27B, but all expert weights still require storage. Treat it as an alternative, not an assured improvement over newer 3.8. |

The successor tags were not installed during this review. No weights were downloaded. The sizes are distribution artifacts, not total runtime VRAM. The 35B author's own agent results vary by benchmark and do not compare against this deployed 3.8 quantized runtime. [35B architecture and author results](https://huggingface.co/Qwen/Qwen3.6-35B-A3B). A [35B Q4_K_M artifact](https://ollama.com/library/qwen3.6:35b-a3b-q4_K_M), about 24 GB, is an optional lower-memory comparison if Q8 leaves insufficient mixed-workload headroom; label the architecture and quantization changes separately.

Public manifest SHA256 values, verified through the official registry's metadata endpoint on the review date:

| Exact tag | Manifest SHA256 |
| --- | --- |
| `qwen3.8:27b-q4_K_M` | `25b843619e944cd0ae6069f94ff4e5e26a16e109ccbc0a66a0f05979ed70098e` |
| `qwen3.8:27b-q8_0` | `8f5fb6b71ea00052cbe8545738c55ce61112c4e571cb60ca4dad00b131766039` |
| `qwen3.6:35b-a3b-q8_0` | `53003244b9b5f589be78818aaaa646fa242472f776f62ed0ccc224e6c29ee5e2` |

These hashes identify the published manifests, not a measured local runtime. Use the corresponding fixed tag; do not substitute `latest`, MTP, MLX or a similarly named quantization. [Q4 manifest](https://registry.ollama.ai/v2/library/qwen3.8/manifests/27b-q4_K_M), [27B Q8 manifest](https://registry.ollama.ai/v2/library/qwen3.8/manifests/27b-q8_0), [35B Q8 manifest](https://registry.ollama.ai/v2/library/qwen3.6/manifests/35b-a3b-q8_0).

## Capacity and larger-model limits

NVIDIA specifies 24 GB per RTX 3090. Two installed cards provide nominal 48 GiB across separate devices; they do not become one automatically unified allocation. Ollama documents loading a fitting model on one GPU and spreading a model that cannot fit across available GPUs. Verify the actual per-card distribution and residency. A fitting current Q4 model may remain on one card, leaving the other available for other work. Raw VRAM does not imply doubled generation speed. [NVIDIA specifications](https://www.nvidia.com/en-us/geforce/graphics-cards/30-series/rtx-3090-3090ti/), [Ollama loading behavior](https://docs.ollama.com/faq#how-does-ollama-load-models-on-multiple-gpus).

Budget separately for weights, KV cache, hybrid recurrent state, vision projector, compute buffers and embedding/OCR overlap. At 65,536 tokens, architecture-based FP16 KV illustrations are about 4 GiB for the full-attention portion of 3.8 27B and 1.25 GiB for 3.6 35B-A3B. These calculations use the attention-layer/head dimensions in the author cards and exclude other allocations; they are not measured VRAM requirements. Hybrid models should not be sized as though every layer uses full attention. [27B architecture](https://huggingface.co/Qwen/Qwen3.8-27B), [35B architecture](https://huggingface.co/Qwen/Qwen3.6-35B-A3B).

A dense 70B is outside the initial 64K shortlist. Llama3.3 Q4_K_M lists about 43 GB of weights; its published 80 layers, 8 KV heads and 128-dimensional keys/values imply another 20 GiB of FP16 KV at 64K, before overhead. Cache quantization or CPU spill changes that comparison and requires separate quality/latency evidence. Qwen3.8 BF16 lists 56 GB and Qwen3.5 122B Q4 lists 81 GB, exceeding the nominal two-card capacity before context. [70B weights](https://ollama.com/library/llama3.3:70b), [tensor metadata](https://ollama.com/library/llama3.3:70b/blobs/4824460d29f2), [3.8 tags](https://ollama.com/library/qwen3.8/tags), [122B tag](https://ollama.com/library/qwen3.5:122b).

Two current larger releases were also screened, without downloading weights:

| Larger candidate | Published artifact and identity | Assessment for two 24 GiB cards |
| --- | --- | --- |
| [GPT-OSS 120B](https://ollama.com/library/gpt-oss:120b) | About **65 GB**, manifest `714d86958b6e870a9320e78126ac1ce3477727a1cd9bf7194b8ace0d84c62fd8` | Published weights already exceed 48 GiB before cache/buffers; it is outside this fully-GPU shortlist. The current official listing is 65 GB, not 63 GB. |
| [Qwen3.8-Flash-Next 125B-A6B Q4_K_M](https://ollama.com/library/qwen3.8-flash-next:125b-a6b-q4_K_M) | About **120 GB**, manifest `f79436a1cc83fd1a9b7752cf62247a2e7ad9fd7775c67230da4254fcc1d07f01` | The author specifies 125B core parameters with 6B active, plus 51B n-gram embeddings and 4B MTP. Sparse activation reduces compute, not the full weight allocation. Embedding offload does not establish a 48 GiB fit for the remaining core. This experimental architecture and its pinned-provider compatibility are unvalidated here. |

Flash-Next is a relevant newer capability candidate, not an omitted automatic successor: its author's improvements and larger memory/architecture requirements need their own supported evaluation. Its MLX NVFP4 tag is a different artifact, not a CUDA substitute for the named GGUF. No custom low-bit quantization, pruning or CPU-offload path is proposed by this initial plan. [Qwen author card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next), [Flash-Next tags](https://ollama.com/library/qwen3.8-flash-next/tags), [GPT-OSS manifest](https://registry.ollama.ai/v2/library/gpt-oss/manifests/120b), [Flash-Next manifest](https://registry.ollama.ai/v2/library/qwen3.8-flash-next/manifests/125b-a6b-q4_K_M).

Parallel requests multiply context allocation, and Ollama's cache quantization setting is global. Keep the existing single-request/cache baseline for the first comparison. Multi-user overlap or a cache experiment needs its own measured result. [Ollama concurrency/cache guidance](https://docs.ollama.com/faq).

## Initial shared-model serving proposal

After card 2 is installed and physical/software readiness is established, the initial proposed settings for the **existing shared Ollama instance** are:

```text
OLLAMA_SCHED_SPREAD=true
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_LOADED_MODELS=1
```

The pinned 0.32.15 source declares these settings; `SCHED_SPREAD` requests placement across available GPUs and `NUM_PARALLEL` controls simultaneous model requests. Apply nothing from this proposal until the installation/validation step, then verify the actual split and per-card allocation rather than treating environment values as proof. [Pinned environment implementation](https://github.com/ollama/ollama/blob/v0.32.15/envconfig/config.go).

`MAX_LOADED_MODELS=1` is the proposed initial resident-model policy for the shared instance. Embedding or retained GPT-profile calls can cause Main to unload and reload, adding latency. This stage provides neither separate model/resource isolation nor accepted parallel OCR/embedding capacity. A separate GPU software consumer can still contend for memory or compute; these settings do not establish an exclusive system-wide GPU reservation. Keep identity/tool permissions and native cancellation/resource safeguards intact without adding arbitrary tool or turn caps.

## Acceptance after installation

1. Confirm card 2's physical, PSU, cooling, driver and existing-container visibility before GPU work. Keep one serving instance and the stock provider/session path.
2. Retain the current model as the control. Pin candidate digest, provider, prompt/tool/schema source, context, actual output request settings and cache policy. Change Main only, one candidate at a time, without concurrent comparison calls.
3. Measure full GPU residency, each card's peak use, CPU spill and prefill/first-token/generation latency during a real native long tool chain. Keep enough measured headroom for the intended embedding/OCR workload.
4. Reuse preserved synthetic cases for ordinary Gmail account selection, fresh/existing long chats, productive work after compaction, exact tool calls, parent/child continuation, literal lists and memory correction. Confirm current SID/run/source/owner/loaded-contract authority, honest results, revocation/cancellation and effect receipts. Do not use extra real mailbox access merely to benchmark a model.
5. Promote only a demonstrated task-quality/resource improvement at acceptable latency. Preserve identity, audience, credential isolation, grants, effect integrity, other profiles, no-fallback policy and disabled scheduling. Retain failures. Rollback restores captured model/descriptor/context settings; it never replaces newer business records, credentials or session history.
