// Signs a Tizen web app (.wgt) the way `tizen package -s` does: an author
// signature over every file, then a distributor signature over every file
// including the author signature (W3C XML Digital Signatures for Widgets,
// RSA-SHA512).
//
// The keys in signing/ are public test keys, not secrets:
//   - author: the "Jellyfin" certificate that jellyfin-tizen-builds commits
//     as tizencert.p12 (password 1234) and that Apps2Samsung ships. Packages
//     signed with it can replace each other on a TV without uninstalling.
//   - distributor: the "Tizen Public Distributor Signer" from the Tizen SDK.
// A Samsung TV in developer mode (Tizen 6 and older) installs packages signed
// with these; Tizen 7 and newer want a Samsung certificate for that TV.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
export const SIGNATURE_FILES = ['author-signature.xml', 'signature1.xml'];

function loadSigner(name) {
    const key = fs.readFileSync(path.join(here, 'signing', `${name}.key.pem`), 'utf8');
    const certs = fs.readFileSync(path.join(here, 'signing', `${name}.certs.pem`), 'utf8')
        .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
        .map(pem => pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g, ''));
    return { key, certs };
}

// base64 in lines of 76 characters, as xmlsec writes it
function wrap(base64) {
    return base64.match(/.{1,76}/g).join('\n');
}

function digest(data) {
    return wrap(crypto.createHash('sha512').update(data).digest('base64'));
}

function reference(uri, digestValue, transform) {
    return `<Reference URI="${uri}">\n` +
        (transform ? `<Transforms>\n<Transform Algorithm="${transform}"></Transform>\n</Transforms>\n` : '') +
        `<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha512"></DigestMethod>\n` +
        `<DigestValue>${digestValue}</DigestValue>\n` +
        `</Reference>\n`;
}

function signatureObject(id, role) {
    return `<Object Id="prop"><SignatureProperties xmlns:dsp="http://www.w3.org/2009/xmldsig-properties">` +
        `<SignatureProperty Id="profile" Target="#${id}"><dsp:Profile URI="http://www.w3.org/ns/widgets-digsig#profile"></dsp:Profile></SignatureProperty>` +
        `<SignatureProperty Id="role" Target="#${id}"><dsp:Role URI="http://www.w3.org/ns/widgets-digsig#role-${role}"></dsp:Role></SignatureProperty>` +
        `<SignatureProperty Id="identifier" Target="#${id}"><dsp:Identifier></dsp:Identifier></SignatureProperty>` +
        `</SignatureProperties></Object>`;
}

// The signed parts are written in canonical form already, so canonicalising
// them only means adding the namespace they inherit from <Signature>.
function canonical(element) {
    return element.replace(/^<(\w+)/, `<$1 xmlns="${DSIG}"`);
}

function sign(files, { id, role, signer }) {
    const object = signatureObject(id, role);
    const signedInfo = '<SignedInfo>\n' +
        '<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>\n' +
        '<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha512"></SignatureMethod>\n' +
        files.map(([name, data]) => reference(encodeURIComponent(name), digest(data))).join('') +
        reference('#prop', digest(canonical(object)), 'http://www.w3.org/2006/12/xml-c14n11') +
        '</SignedInfo>';
    const signatureValue = crypto.createSign('RSA-SHA512').update(canonical(signedInfo)).sign(signer.key, 'base64');

    return `<Signature xmlns="${DSIG}" Id="${id}">\n` +
        `${signedInfo}\n` +
        `<SignatureValue>\n${wrap(signatureValue)}\n</SignatureValue>\n` +
        '<KeyInfo>\n<X509Data>\n' +
        signer.certs.map(cert => `<X509Certificate>\n${wrap(cert)}\n</X509Certificate>\n`).join('') +
        '</X509Data>\n</KeyInfo>\n' +
        `${object}\n</Signature>`;
}

// files: [name, Buffer] for every file in the package except the signatures.
// Returns the two signature files to add.
export function signPackage(files) {
    const ordered = files
        .filter(([name]) => !SIGNATURE_FILES.includes(name) && !name.endsWith('/'))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const author = sign(ordered, { id: 'AuthorSignature', role: 'author', signer: loadSigner('author') });
    const withAuthor = [...ordered, ['author-signature.xml', Buffer.from(author)]]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const distributor = sign(withAuthor, { id: 'DistributorSignature', role: 'distributor', signer: loadSigner('distributor') });

    return { 'author-signature.xml': author, 'signature1.xml': distributor };
}
