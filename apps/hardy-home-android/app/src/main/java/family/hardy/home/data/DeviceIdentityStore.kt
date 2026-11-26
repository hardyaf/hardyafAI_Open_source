package family.hardy.home.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import family.hardy.home.api.generated.HouseholdRequestSigner
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID

class DeviceIdentityStore(context: Context) : HouseholdRequestSigner {
    private val preferences = context.getSharedPreferences("hardy_home_device", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    var serverUrl: String
        get() = preferences.getString("server_url", null) ?: ""
        set(value) { preferences.edit().putString("server_url", value.trimEnd('/')).apply() }

    val deviceId: String?
        get() = preferences.getString("device_id", null)

    val isEnrolled: Boolean
        get() = !deviceId.isNullOrBlank() && keyStore.containsAlias(keyAlias)

    fun publicKeyDerBase64(): String {
        ensureKey()
        val certificate = keyStore.getCertificate(keyAlias)
        return Base64.encodeToString(certificate.publicKey.encoded, Base64.NO_WRAP)
    }

    fun completeEnrollment(deviceId: String, serverUrl: String) {
        preferences.edit()
            .putString("device_id", deviceId)
            .putString("server_url", serverUrl.trimEnd('/'))
            .apply()
    }

    fun clearEnrollment() {
        preferences.edit().remove("device_id").commit()
        if (keyStore.containsAlias(keyAlias)) keyStore.deleteEntry(keyAlias)
    }

    fun ensureKey() {
        if (keyStore.containsAlias(keyAlias)) return
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        val parameters = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_SIGN,
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
            .build()
        generator.initialize(parameters)
        generator.generateKeyPair()
    }

    override fun headers(method: String, path: String, body: ByteArray): Map<String, String> {
        val enrolledDeviceId = requireNotNull(deviceId) { "Device is not enrolled" }
        ensureKey()
        val timestamp = System.currentTimeMillis().toString()
        val nonce = "nonce-${UUID.randomUUID()}"
        val canonical = canonicalDeviceRequest(method, path, timestamp, nonce, body)
        val privateKey = keyStore.getKey(keyAlias, null)
        val signer = Signature.getInstance("SHA256withECDSA").apply {
            initSign(privateKey as java.security.PrivateKey)
            update(canonical.toByteArray(Charsets.UTF_8))
        }
        return mapOf(
            "X-Hardy-Device-Id" to enrolledDeviceId,
            "X-Hardy-Timestamp" to timestamp,
            "X-Hardy-Nonce" to nonce,
            "X-Hardy-Signature" to Base64.encodeToString(signer.sign(), Base64.NO_WRAP),
        )
    }

    companion object {
        private const val keyAlias = "hardy-home-device-v1"
    }
}
