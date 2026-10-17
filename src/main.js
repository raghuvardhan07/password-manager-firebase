import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "@firebase/auth";
import { auth, db } from "./firebase";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
    writeBatch,
} from "@firebase/firestore";

const statusEle = document.getElementById("status");
const signInBtn = document.getElementById("sign-in");
const signOutBtn = document.getElementById("sign-out");

const vaultEl = document.getElementById("vault");
const listEl = document.getElementById("list");
const tagEl = document.getElementById("tag");
const noteEl = document.getElementById("note");
const passwordEl = document.getElementById("password");
const addBtn = document.getElementById("add");

const breadcrumbEl = document.getElementById("breadcrumb");
const folderNameEl = document.getElementById("folder-name");
const addFolderBtn = document.getElementById("add-folder");
const folderListEl = document.getElementById("folder-list");

let currentFolderId = null;
let folders = new Map();
let stopFolders = null;
let stopPasswords = null;

const MAX_DEPTH = 5;

console.log("current user at load: ", auth.currentUser);

signInBtn.addEventListener("click", async () => {
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
        console.error("Failed sign in", err);
    }
});

signOutBtn.addEventListener("click", () => signOut(auth));

function depthOf(folderId) {
    let depth = 0;

    let cursor = folderId;

    while (cursor) {
        depth++;
        cursor = folders.get(cursor)?.parentId ?? null;

        if (depth > 50) throw new Error("too deep");
    }

    return depth;
}

function collectSubtree(rootId) {
    const ids = [rootId];

    for (const id of ids) {
        for (const f of folders.values()) {
            if (f.parentId === id) ids.push(f.id);
        }
    }

    return ids;
}

addFolderBtn.addEventListener("click", async () => {
    const user = auth.currentUser;

    const name = folderNameEl.value.trim();

    if (!user || !name) return null;

    if (depthOf(currentFolderId) + 1 > MAX_DEPTH) {
        alert(`Max folder limit is ${MAX_DEPTH}`);
        return;
    }

    await addDoc(collection(db, "folders"), {
        userId: user.uid,
        familyId: null,
        parentId: currentFolderId,
        name,
    });

    folderNameEl.value = "";
});

function watchFolders(uid) {
    const q = query(
        collection(db, "folders"),
        where("userId", "==", uid),
        where("familyId", "==", null),
    );

    stopFolders = onSnapshot(q, (snapshot) => {
        folders = new Map();
        snapshot.forEach((d) => folders.set(d.id, { id: d.id, ...d.data() }));

        if (currentFolderId && !folders.has(currentFolderId)) {
            currentFolderId = null;
            watchPasswords(uid);
        }
        renderBreadcrumb();
        renderFolders();
    });
}

function renderBreadcrumb() {
    breadcrumbEl.textContent = "";

    const path = [];

    let cursor = currentFolderId;
    while (cursor) {
        path.unshift(folders.get(cursor));
        cursor = folders.get(cursor)?.parentId ?? null;
    }

    const home = document.createElement("button");

    home.textContent = "Home";

    home.addEventListener("click", () => openFolder(null));

    breadcrumbEl.append(home);

    for (const f of path) {
        breadcrumbEl.append(" > ");

        const btn = document.createElement("button");

        btn.textContent = f.name;

        btn.addEventListener("click", () => openFolder(f.id));

        breadcrumbEl.append(btn);
    }

    console.log(breadcrumbEl.textContent);
}

function renderFolders() {
    folderListEl.textContent = "";

    for (const f of folders.values()) {
        if (f.parentId !== currentFolderId) continue;

        const li = document.createElement("li");

        const openBtn = document.createElement("button");

        openBtn.textContent = `📁 ${f.name}`;

        openBtn.addEventListener("click", () => openFolder(f.id));

        const delBtn = document.createElement("button");

        delBtn.textContent = "Delete";

        delBtn.addEventListener("click", () => deleteFolderTree(f.id));

        li.append(openBtn, delBtn);

        folderListEl.append(li);
    }
}

function openFolder(folderId) {
    currentFolderId = folderId;

    renderBreadcrumb();
    renderFolders();
    watchPasswords(auth.currentUser.uid);
}

async function deleteFolderTree(folderId) {
    const uid = auth.currentUser.uid;

    const folderIds = collectSubtree(folderId);

    if (
        !confirm(
            `Delete this folder, ${folderIds.length - 1} subfolder(s) and all passwords inside?`,
        )
    )
        return;

    const batch = writeBatch(db);

    for (const id of folderIds) {
        batch.delete(doc(db, "folders", id));

        const pwSnap = await getDocs(
            query(
                collection(db, "passwords"),
                where("userId", "==", uid),
                where("familyId", "==", null),
                where("folderId", "==", id),
            ),
        );

        pwSnap.forEach((d) => batch.delete(d.ref));
    }

    await batch.commit();
}

async function ensureUserDoc(user) {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
        console.log("Creating user doc as its first sign in");

        await setDoc(ref, {
            name: user.displayName,
            familyId: null,
            salt: "tata shudh",
            createdAt: serverTimestamp(),
        });
    } else {
        console.log(`Existing user doc: ${snap.data()}`);
    }
}

addBtn.addEventListener("click", async () => {
    const user = auth.currentUser;

    if (!user || !tagEl.value || !passwordEl.value) return;

    await addDoc(collection(db, "passwords"), {
        userId: user.uid,
        familyId: null,
        folderId: currentFolderId,
        tag: tagEl.value,
        note: noteEl.value || null,
        password: passwordEl.value,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });

    tagEl.value = noteEl.val = passwordEl.val = "";
});

function watchPasswords(uid) {
    if (stopPasswords) stopPasswords();

    const q = query(
        collection(db, "passwords"),
        where("userId", "==", uid),
        where("familyId", "==", null),
        where("folderId", "==", currentFolderId),
    );

    stopPasswords = onSnapshot(q, (snapshot) => {
        listEl.textContent = "";

        snapshot.forEach((docSnap) => {
            const item = docSnap.data();
            const li = document.createElement("li");

            const created = item.createdAt ? item.createdAt.toDate().toLocaleString() : "saving...";
            li.textContent = `${item.tag} | ${item.note ?? "-"} | ${item.password} | created ${created} `;

            const editBtn = document.createElement("button");
            editBtn.textContent = "Edit tag";
            editBtn.addEventListener("click", async () => {
                const newTag = prompt("New tag:", item.tag);
                if (!newTag) return;
                await updateDoc(doc(db, "passwords", docSnap.id), {
                    tag: newTag,
                    updatedAt: serverTimestamp(),
                });
            });

            const delBtn = document.createElement("button");
            delBtn.textContent = "Delete";
            delBtn.addEventListener("click", () => deleteDoc(doc(db, "passwords", docSnap.id)));

            li.append(editBtn, delBtn);
            listEl.append(li);
        });
    });
}

function stopAll() {
    if (stopFolders) stopFolders();
    if (stopPasswords) stopPasswords();
    stopFolders = stopPasswords = null;
    folders = new Map();
    currentFolderId = null;
}

onAuthStateChanged(auth, async (user) => {
    stopAll();
    console.log("auth state changed: ", user);

    if (user) {
        statusEle.textContent = `Signed in as ${user.displayName} (uid: ${user.uid})`;
        signInBtn.hidden = true;
        signOutBtn.hidden = false;

        vaultEl.hidden = false;
        await ensureUserDoc(user);
        watchFolders(user.uid);
        watchPasswords(user.uid);
    } else {
        statusEle.textContent = "Signed out";
        signInBtn.hidden = false;
        signOutBtn.hidden = true;

        vaultEl.hidden = true;
        listEl.textContent = "";
        folderListEl.textContent = "";
        breadcrumbEl.textContent = "";
    }
});
