import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(root, "contracts", "household-api", "openapi.json");
const outputPath = resolve(
  root,
  "apps",
  "hardy-home-android",
  "app",
  "src",
  "main",
  "java",
  "family",
  "hardy",
  "home",
  "api",
  "generated",
  "GeneratedHouseholdApiClient.kt",
);
const source = readFileSync(contractPath, "utf8");
const spec = JSON.parse(source);
const contractHash = createHash("sha256").update(source).digest("hex");
const operations = [];
function resolveParameter(value) {
  if (!value?.$ref) return value;
  const name = value.$ref.match(/^#\/components\/parameters\/([^/]+)$/)?.[1];
  if (!name || !spec.components?.parameters?.[name]) throw new Error("unsupported_parameter_reference");
  return spec.components.parameters[name];
}

for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = pathItem[method];
    if (!operation?.operationId) continue;
    operations.push({
      path,
      method: method.toUpperCase(),
      operationId: operation.operationId,
      authenticated: operation.security === undefined ? true : operation.security.length > 0,
      hasBody: Boolean(operation.requestBody),
      stream: operation.operationId === "streamEvents",
      binary: operation["x-response-kind"] === "bytes",
      deprecated: operation.deprecated === true,
      query: [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(resolveParameter).filter(parameter => parameter.in === "query"),
    });
  }
}

function functionSource(operation) {
  const parameters = [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const args = [...parameters.map((name) => `${name}: String`), ...(operation.hasBody ? ["body: String"] : []),
    ...operation.query.map(parameter => `${parameter.name}: ${parameter.schema?.type === "integer" ? "Int" : "String"}${parameter.required ? "" : "? = null"}`)];
  let kotlinPath = operation.path;
  for (const parameter of parameters) kotlinPath = kotlinPath.replace(`{${parameter}}`, `\${encodePath(${parameter})}`);
  const requestPath = operation.query.length ? `withQuery("${kotlinPath}", listOf(${operation.query.map(parameter => `"${parameter.name}" to ${parameter.name}${parameter.required ? "" : "?"}.toString()`).join(", ")}))` : `"${kotlinPath}"`;
  const annotation = operation.deprecated ? '    @Deprecated("This API operation is retired and returns no successful mutation")\n' : "";
  if (operation.stream) {
    return `${annotation}    fun ${operation.operationId}(${args.join(", ")}): HttpURLConnection =\n        connection("${operation.method}", ${requestPath}, null, ${operation.authenticated}, "text/event-stream")`;
  }
  return `${annotation}    suspend fun ${operation.operationId}(${args.join(", ")}): ${operation.binary ? "ApiBytesResponse" : "ApiResponse"} =\n        ${operation.binary ? "executeBytes" : "execute"}("${operation.method}", ${requestPath}, ${operation.hasBody ? "body" : "null"}, ${operation.authenticated})`;
}

const generated = `// Generated from contracts/household-api/openapi.json. Do not edit by hand.
// Contract SHA-256: ${contractHash}
package family.hardy.home.api.generated

import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class ApiResponse(val status: Int, val body: String)
data class ApiBytesResponse(val status: Int, val body: ByteArray, val contentType: String?)

fun interface HouseholdRequestSigner {
    fun headers(method: String, path: String, body: ByteArray): Map<String, String>
}

class GeneratedHouseholdApiClient(
    baseUrl: String,
    private val signer: HouseholdRequestSigner? = null,
) {
    private val origin = baseUrl.trimEnd('/')

    companion object {
        const val contractVersion = "${spec.info.version}"
        const val contractSha256 = "${contractHash}"
    }

${operations.map(functionSource).join("\n\n")}

    private fun withQuery(path: String, parameters: List<Pair<String, String?>>): String {
        val query = parameters.filter { it.second != null }
            .joinToString("&") { (name, value) -> encodePath(name) + "=" + encodePath(requireNotNull(value)) }
        return if (query.isEmpty()) path else path + "?" + query
    }

    private suspend fun executeBytes(
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean,
    ): ApiBytesResponse = withContext(Dispatchers.IO) {
        val connection = connection(method, path, body, authenticated, "*/*")
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            ApiBytesResponse(status, stream?.use { it.readBytes() } ?: ByteArray(0), connection.contentType)
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun execute(
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean,
    ): ApiResponse = withContext(Dispatchers.IO) {
        val connection = connection(method, path, body, authenticated, "application/json")
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            ApiResponse(status, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
        } finally {
            connection.disconnect()
        }
    }

    private fun connection(
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean,
        accept: String,
    ): HttpURLConnection {
        require(origin.startsWith("https://") || origin.startsWith("http://")) { "Server URL must use HTTP or HTTPS" }
        require(!path.startsWith("/v1/connections") || origin.startsWith("https://")) { "Connections require HTTPS" }
        val bytes = body?.toByteArray(StandardCharsets.UTF_8) ?: ByteArray(0)
        val connection = URI.create(origin + path).toURL().openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = if (accept == "text/event-stream") 0 else 60_000
        connection.setRequestProperty("Accept", accept)
        connection.setRequestProperty("Cache-Control", "no-store")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setFixedLengthStreamingMode(bytes.size)
        }
        if (authenticated) {
            val requestSigner = requireNotNull(signer) { "An enrolled device signer is required" }
            requestSigner.headers(method, path, bytes).forEach(connection::setRequestProperty)
        }
        return connection
    }

    private fun encodePath(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}
`;

mkdirSync(dirname(outputPath), { recursive: true });
if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== generated) {
    process.stderr.write("Generated Android client is out of date. Run: node tools/generate-household-client.mjs\n");
    process.exitCode = 1;
  }
} else {
  writeFileSync(outputPath, generated, "utf8");
  process.stdout.write(`${outputPath}\n`);
}
