// node test/signature.mjs <original.wgt> [built.wgt ...]
//
// The original package from jellyfin-tizen-builds was signed by `tizen package`
// with the same certificates as sign.mjs uses. Signing its untouched contents
// again must give byte-identical signature files. Every built package is then
// checked: each file's digest and both signature values.

import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { signPackage, SIGNATURE_FILES } from '../sign.mjs';

let failures = 0;
const [original, ...built] = process.argv.slice(2);
if (!original) {
    console.error('Usage: node test/signature.mjs <original.wgt> [built.wgt ...]');
    process.exit(1);
}

const contents = zip => zip.getEntries().filter(entry => !entry.isDirectory).map(entry => [entry.entryName, entry.getData()]);

{
    const zip = new AdmZip(original);
    const signed = signPackage(contents(zip));
    for (const name of SIGNATURE_FILES) {
        const same = zip.getEntry(name)?.getData().toString('utf8') === signed[name];
        console.log(`${name}: ${same ? 'identical to tizen package' : 'DIFFERENT from tizen package'}`);
        if (!same) failures += 1;
    }
}

function verify(zip, name) {
    const xml = zip.getEntry(name)?.getData().toString('utf8');
    if (!xml) return [`${name} missing`];
    const problems = [];
    const references = [...xml.matchAll(/<Reference URI="([^"#][^"]*)">[\s\S]*?<DigestValue>([^<]+)<\/DigestValue>/g)];
    const covered = new Set();
    for (const [, uri, value] of references) {
        const file = decodeURIComponent(uri);
        covered.add(file);
        const entry = zip.getEntry(file);
        const actual = entry && crypto.createHash('sha512').update(entry.getData()).digest('base64');
        if (actual !== value.replace(/\s/g, '')) problems.push(`${name}: digest of ${file} does not match`);
    }
    for (const [file] of contents(zip)) {
        if (file !== name && file !== 'signature1.xml' && !covered.has(file)) problems.push(`${name}: ${file} not signed`);
    }
    const signedInfo = xml.match(/<SignedInfo>[\s\S]*<\/SignedInfo>/)[0].replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
    const value = xml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)[1].replace(/\s/g, '');
    const cert = xml.match(/<X509Certificate>([^<]+)<\/X509Certificate>/)[1].replace(/\s/g, '');
    const key = new crypto.X509Certificate(Buffer.from(cert, 'base64')).publicKey;
    if (!crypto.verify('RSA-SHA512', Buffer.from(signedInfo), key, Buffer.from(value, 'base64'))) problems.push(`${name}: signature value invalid`);
    return problems;
}

for (const file of built) {
    const zip = new AdmZip(file);
    const problems = SIGNATURE_FILES.flatMap(name => verify(zip, name));
    console.log(`${file}: ${problems.length ? problems.join('; ') : `signed, ${zip.getEntries().length} entries checked`}`);
    failures += problems.length;
}

if (failures) process.exit(1);
