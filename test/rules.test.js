import { readFileSync } from "node:fs";
import { before, after, beforeEach, test } from "node:test";
import {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} from "@firebase/rules-unit-testing";
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    collection,
    getDocs,
    query,
    where,
} from "firebase/firestore";

let env;

before(async () => {
    env = await initializeTestEnvironment({
        projectId: "demo-vault",
        firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
});

after(async () => {
    await env.cleanup();
});

// Fresh data before every test, written with rules switched off
beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, "users/alice"), { name: "Alice", familyId: "fam1" });
        await setDoc(doc(db, "users/bob"), { name: "Bob", familyId: "fam1" });
        await setDoc(doc(db, "users/carol"), { name: "Carol", familyId: null });
        await setDoc(doc(db, "families/fam1"), { name: "Fam", createdBy: "alice" });
        await setDoc(doc(db, "passwords/alicePersonal"), {
            userId: "alice",
            familyId: null,
            folderId: null,
            tag: "personal",
        });
        await setDoc(doc(db, "passwords/shared1"), {
            userId: "alice",
            familyId: "fam1",
            folderId: null,
            tag: "shared",
        });
    });
});

// helpers: a database handle acting as a given user
const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

/* ---------- users ---------- */

test("user can read own user doc", async () => {
    await assertSucceeds(getDoc(doc(as("alice"), "users/alice")));
});

test("user cannot read someone else's user doc", async () => {
    await assertFails(getDoc(doc(as("bob"), "users/alice")));
});

test("signed-out visitor cannot read anything", async () => {
    await assertFails(getDoc(doc(anon(), "passwords/shared1")));
});

/* ---------- personal passwords ---------- */

test("owner can read own personal password", async () => {
    await assertSucceeds(getDoc(doc(as("alice"), "passwords/alicePersonal")));
});

test("another user cannot read it", async () => {
    await assertFails(getDoc(doc(as("bob"), "passwords/alicePersonal")));
});

test("owner's filtered query works", async () => {
    const q = query(
        collection(as("alice"), "passwords"),
        where("userId", "==", "alice"),
        where("familyId", "==", null),
    );
    await assertSucceeds(getDocs(q));
});

test("rules are not filters: unfiltered query is rejected", async () => {
    await assertFails(getDocs(collection(as("alice"), "passwords")));
});

test("cannot query someone else's personal items", async () => {
    const q = query(
        collection(as("bob"), "passwords"),
        where("userId", "==", "alice"),
        where("familyId", "==", null),
    );
    await assertFails(getDocs(q));
});

test("can create personal item as yourself", async () => {
    await assertSucceeds(
        setDoc(doc(as("alice"), "passwords/new1"), {
            userId: "alice",
            familyId: null,
            folderId: null,
            tag: "n",
        }),
    );
});

test("cannot create an item owned by someone else", async () => {
    await assertFails(
        setDoc(doc(as("alice"), "passwords/new2"), {
            userId: "bob",
            familyId: null,
            folderId: null,
            tag: "n",
        }),
    );
});

test("cannot hand your item to another user", async () => {
    await assertFails(updateDoc(doc(as("alice"), "passwords/alicePersonal"), { userId: "bob" }));
});

test("cannot flip a personal item into a shared one", async () => {
    await assertFails(updateDoc(doc(as("alice"), "passwords/alicePersonal"), { familyId: "fam1" }));
});

/* ---------- shared passwords ---------- */

test("family member can read shared item", async () => {
    await assertSucceeds(getDoc(doc(as("bob"), "passwords/shared1")));
});

test("non-member cannot read shared item", async () => {
    await assertFails(getDoc(doc(as("carol"), "passwords/shared1")));
});

test("member can query the shared space", async () => {
    const q = query(collection(as("bob"), "passwords"), where("familyId", "==", "fam1"));
    await assertSucceeds(getDocs(q));
});

test("non-member cannot query the shared space", async () => {
    const q = query(collection(as("carol"), "passwords"), where("familyId", "==", "fam1"));
    await assertFails(getDocs(q));
});

test("creator can edit shared item", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), "passwords/shared1"), { tag: "edited" }));
});

test("member cannot edit shared item", async () => {
    await assertFails(updateDoc(doc(as("bob"), "passwords/shared1"), { tag: "hacked" }));
});

test("member cannot delete shared item", async () => {
    await assertFails(deleteDoc(doc(as("bob"), "passwords/shared1")));
});

test("creator can create shared item", async () => {
    await assertSucceeds(
        setDoc(doc(as("alice"), "passwords/shared2"), {
            userId: "alice",
            familyId: "fam1",
            folderId: null,
            tag: "s",
        }),
    );
});

test("member cannot create shared item", async () => {
    await assertFails(
        setDoc(doc(as("bob"), "passwords/shared3"), {
            userId: "bob",
            familyId: "fam1",
            folderId: null,
            tag: "s",
        }),
    );
});

/* ---------- families ---------- */

test("signed-in user can fetch a family by id", async () => {
    await assertSucceeds(getDoc(doc(as("carol"), "families/fam1")));
});

test("nobody can list families", async () => {
    await assertFails(getDocs(collection(as("alice"), "families")));
});

test("only the creator can rename the family", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), "families/fam1"), { name: "New" }));
    await assertFails(updateDoc(doc(as("bob"), "families/fam1"), { name: "Hijack" }));
});
