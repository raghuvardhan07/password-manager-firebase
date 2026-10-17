const salt = crypto.getRandomValues(new Uint8Array(16)); // size 16 array of unsigned integer of 8 bits (0 - 255), so basically 16 bytes

const enc = new TextEncoder();
const dec = new TextDecoder();

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

let currentKey = null;
let lastSealed = null;

async function deriveKey(password, salt) {
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
        "deriveKey",
    ]);

    const finalKey = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
    );

    return finalKey;
}

async function seal(key, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));

    return { iv: toBase64(iv), cipherText: toBase64(cipher) };
}

async function open(key, sealed) {
    const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(sealed.iv) },
        key,
        fromBase64(sealed.cipherText),
    );

    return dec.decode(plain);
}
document.getElementById("derive").addEventListener("click", async () => {
    const password = document.getElementById("password").value;

    if (!password) return;

    const key = await deriveKey(password, salt);

    currentKey = key;

    const raw = await crypto.subtle.exportKey("raw", key);

    document.getElementById("out").textContent = `Salt: ${toBase64(salt)} \n Key: ${toBase64(raw)}`;
});

document.getElementById("encrypt").addEventListener("click", async () => {
    if (!currentKey) return alert("Derive a key, then call");

    const text = document.getElementById("message").value;

    if (!text) return;

    lastSealed = await seal(currentKey, text);

    document.getElementById("enc-out").textContent =
        `Stored: \n ${JSON.stringify(lastSealed, null, 2)}`;
});

document.getElementById("decrypt").addEventListener("click", async () => {
    if (!currentKey || !lastSealed) return alert("No operation to perform");

    try {
        const text = await open(currentKey, lastSealed);
        document.getElementById("enc-out").textContent += `\n\n Decrypted: ${text}`;
    } catch (err) {
        document.getElementById("enc-out").textContent += `\n\n Failure: ${err.name}`;
    }
});

let userDoc = null;

document.getElementById("setup").addEventListener("click", async () => {
    const password = document.getElementById("password").value;
    if (!password) return;

    const key = await deriveKey(password, salt);
    const check = await seal(key, "ok"); // encrypt a known word

    userDoc = { salt: toBase64(salt), check };
    document.getElementById("user-out").textContent =
        "user doc:\n" + JSON.stringify(userDoc, null, 2);
});

document.getElementById("unlock").addEventListener("click", async () => {
    if (!userDoc) return alert("Run setup first");
    const password = document.getElementById("password").value;
    const out = document.getElementById("user-out");

    const key = await deriveKey(password, fromBase64(userDoc.salt));

    try {
        const word = await open(key, userDoc.check);
        if (word !== "ok") throw new Error("unexpected value");
        currentKey = key;
        out.textContent += "\n\nUNLOCKED";
    } catch {
        currentKey = null;
        out.textContent += "\n\nWrong master password";
    }
});
