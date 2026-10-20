# Signing keys

Public test keys, committed on purpose. They are not secrets and give no
access to anything; they only make a TV in developer mode accept the package.

- `author.*` is the "Jellyfin" author certificate that
  [jellyfin-tizen-builds](https://github.com/jeppevinkel/jellyfin-tizen-builds)
  commits as `tizencert.p12` (password `1234`). Using the same one means this
  package and theirs can replace each other on a TV without uninstalling.
- `distributor.*` is the "Tizen Public Distributor Signer" that ships with the
  Tizen SDK.

`sign.mjs` produces byte-for-byte the same signature files as `tizen package -s`
for the same contents and keys.
