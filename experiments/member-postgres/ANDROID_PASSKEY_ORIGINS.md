# Android passkey origin boundary

Android Credential Manager passkey assertions identify an installed app with an origin of the form `android:apk-key-hash:<digest>`. The digest is the unpadded base64url SHA-256 digest of the APK signing certificate. It is distinct from the HTTPS service origin and from the application package name.

`deployment/config.json` therefore carries `androidAppOrigins`, an explicit allow-list of release signing-certificate origins. Entries must be canonical, unique, byte-for-byte sorted, and there may be at most eight. The empty development value keeps Android ceremonies disabled. Adding or rotating a certificate changes the runtime fingerprint and requires the same reviewed deployment/migration procedure as any other security-bound runtime configuration change.

The HTTPS `origin` remains the signed operation scope and must still match the relying-party hostname. The configured Android origins are accepted only as WebAuthn `clientDataJSON.origin` values for registration, login, prepared operations, and portable host-move assertions. An assertion from any other certificate is refused. Digital Asset Links association and a release-signed physical-device ceremony are separate deployment acceptance evidence; configuration alone does not establish either one.
