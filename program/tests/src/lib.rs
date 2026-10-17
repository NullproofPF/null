//! Integration tests for the NULL verifier program, executed in-process with
//! LiteSVM against the compiled SBF binary. Proof fixtures are real Semaphore
//! v4 Groth16 proofs produced by scripts/gen-fixtures.ts.
//!
//! Run: `cargo test -p null-verifier-tests --release -- --nocapture`
//! (build the program first: `cargo build-sbf --manifest-path programs/null-verifier/Cargo.toml`)

#![cfg(test)]

use std::collections::HashMap;
use std::path::PathBuf;

use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const PROGRAM_ID: &str = "EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS";
const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";
const COMPUTE_BUDGET_PROGRAM: &str = "ComputeBudget111111111111111111111111111111";

// Anchor custom error codes start at 6000, in declaration order.
const ERR_UNAUTHORIZED: u32 = 6000;
const ERR_UNKNOWN_ROOT: u32 = 6001;
const ERR_STALE_ROOT: u32 = 6002;
const ERR_NULLIFIER_USED: u32 = 6003;
const ERR_SCOPE_GROUP_MISMATCH: u32 = 6004;
const ERR_INVALID_PUBLIC_INPUT: u32 = 6005;
const ERR_MALFORMED_PROOF: u32 = 6006;
const ERR_INVALID_PROOF: u32 = 6007;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixtures {
    program_id: String,
    group_id: String,
    group_pda: String,
    root: String,
    forged_root: String,
    scopes: HashMap<String, ScopeFixture>,
    proofs: HashMap<String, ProofFixture>,
    forged: ProofFixture,
    hash_vectors: Vec<HashVector>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopeFixture {
    scope_id: String,
    scope_value: String,
    scope_pda: String,
    one_time: bool,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProofFixture {
    label: String,
    scope: String,
    root: String,
    nullifier: String,
    message: String,
    proof: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HashVector {
    input: String,
    semaphore_hash: String,
}

fn fixtures() -> Fixtures {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/semaphore-fixtures.json");
    let raw = std::fs::read_to_string(&path)
        .expect("fixtures missing; run `npx tsx scripts/gen-fixtures.ts`");
    serde_json::from_str(&raw).expect("fixtures parse")
}

fn hex32(s: &str) -> [u8; 32] {
    let v = hex::decode(s).expect("hex");
    v.try_into().expect("32 bytes")
}

fn hex256(s: &str) -> [u8; 256] {
    let v = hex::decode(s).expect("hex");
    v.try_into().expect("256 bytes")
}

// ---------------------------------------------------------------------------
// Encoding helpers (mirror src/lib/solana/program.ts)
// ---------------------------------------------------------------------------

fn program_id() -> Address {
    PROGRAM_ID.parse().unwrap()
}

fn system_program() -> Address {
    SYSTEM_PROGRAM.parse().unwrap()
}

fn disc(name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("global:{name}").as_bytes());
    h[..8].try_into().unwrap()
}

fn group_pda(group_id: &[u8; 32]) -> Address {
    Address::find_program_address(&[b"group", group_id], &program_id()).0
}

fn scope_pda(group: &Address, scope_id: &[u8; 32]) -> Address {
    Address::find_program_address(&[b"scope", group.as_ref(), scope_id], &program_id()).0
}

fn nullifier_pda(scope: &Address, nullifier: &[u8; 32]) -> Address {
    Address::find_program_address(&[b"nullifier", scope.as_ref(), nullifier], &program_id()).0
}

fn receipt_pda(scope: &Address, index: u64) -> Address {
    Address::find_program_address(
        &[b"receipt", scope.as_ref(), &index.to_le_bytes()],
        &program_id(),
    )
    .0
}

fn ix_initialize_group(
    admin: &Address,
    group_id: [u8; 32],
    initial_root: [u8; 32],
    validity: u64,
) -> Instruction {
    let mut data = disc("initialize_group").to_vec();
    data.extend_from_slice(&group_id);
    data.extend_from_slice(&initial_root);
    data.extend_from_slice(&validity.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(group_pda(&group_id), false),
            AccountMeta::new_readonly(system_program(), false),
        ],
        data,
    }
}

fn ix_update_root(
    admin: &Address,
    group: &Address,
    root: [u8; 32],
    member_count: u64,
) -> Instruction {
    let mut data = disc("update_group_root").to_vec();
    data.extend_from_slice(&root);
    data.extend_from_slice(&member_count.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(*group, false),
        ],
        data,
    }
}

fn ix_set_root_validity(admin: &Address, group: &Address, validity: u64) -> Instruction {
    let mut data = disc("set_root_validity").to_vec();
    data.extend_from_slice(&validity.to_le_bytes());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(*group, false),
        ],
        data,
    }
}

fn ix_transfer_admin(admin: &Address, group: &Address, new_admin: &Address) -> Instruction {
    let mut data = disc("transfer_group_admin").to_vec();
    data.extend_from_slice(new_admin.as_ref());
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(*admin, true),
            AccountMeta::new(*group, false),
        ],
        data,
    }
}

fn ix_create_scope(
    admin: &Address,
    group: &Address,
    scope_id: [u8; 32],
    one_time: bool,
) -> Instruction {
    let mut data = disc("create_scope").to_vec();
    data.extend_from_slice(&scope_id);
    data.push(one_time as u8);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new(*group, false),
            AccountMeta::new(scope_pda(group, &scope_id), false),
            AccountMeta::new_readonly(system_program(), false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn ix_verify(
    payer: &Address,
    group: &Address,
    scope: &Address,
    receipt_index: u64,
    root: [u8; 32],
    nullifier: [u8; 32],
    message: [u8; 32],
    proof: [u8; 256],
) -> Instruction {
    let mut data = disc("verify_proof").to_vec();
    data.extend_from_slice(&root);
    data.extend_from_slice(&nullifier);
    data.extend_from_slice(&message);
    data.extend_from_slice(&proof);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(*group, false),
            AccountMeta::new(*scope, false),
            AccountMeta::new(nullifier_pda(scope, &nullifier), false),
            AccountMeta::new(receipt_pda(scope, receipt_index), false),
            AccountMeta::new_readonly(system_program(), false),
        ],
        data,
    }
}

fn ix_compute_limit(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: COMPUTE_BUDGET_PROGRAM.parse().unwrap(),
        accounts: vec![],
        data,
    }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

struct Harness {
    svm: LiteSVM,
    admin: Keypair,
    relayer: Keypair,
    fx: Fixtures,
    group: Address,
    scopes: HashMap<String, Address>,
}

impl Harness {
    fn new() -> Self {
        let fx = fixtures();
        assert_eq!(
            fx.program_id, PROGRAM_ID,
            "fixtures were generated for another program id"
        );
        let so =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/deploy/null_verifier.so");
        let bytes = std::fs::read(&so).expect("program binary missing; run cargo build-sbf");

        let mut svm = LiteSVM::new();
        svm.add_program(program_id(), &bytes).expect("add program");
        let admin = Keypair::new();
        let relayer = Keypair::new();
        svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&relayer.pubkey(), 10_000_000_000).unwrap();

        let group_id = hex32(&fx.group_id);
        let group = group_pda(&group_id);
        assert_eq!(
            group.to_string(),
            fx.group_pda,
            "PDA derivation differs from TypeScript"
        );

        Harness {
            svm,
            admin,
            relayer,
            fx,
            group,
            scopes: HashMap::new(),
        }
    }

    fn send(
        &mut self,
        ixs: &[Instruction],
        signers: &[&Keypair],
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let payer = signers[0].pubkey();
        let msg = Message::new(ixs, Some(&payer));
        let tx = Transaction::new(signers, msg, self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }

    fn admin_send(&mut self, ix: Instruction) -> TransactionMetadata {
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &[&admin])
            .unwrap_or_else(|e| panic!("admin tx failed: {:?}\n{:#?}", e.err, e.meta.logs))
    }

    /// Initialize the group with the fixture root published and all fixture scopes created.
    fn setup_group(&mut self, validity: u64) {
        let group_id = hex32(&self.fx.group_id);
        let admin_pk = self.admin.pubkey();
        self.admin_send(ix_initialize_group(
            &admin_pk, group_id, [0u8; 32], validity,
        ));
        let root = hex32(&self.fx.root);
        self.admin_send(ix_update_root(&admin_pk, &self.group, root, 2));
        let scope_names: Vec<String> = self.fx.scopes.keys().cloned().collect();
        for name in scope_names {
            let sf = &self.fx.scopes[&name];
            let scope_id = hex32(&sf.scope_id);
            let one_time = sf.one_time;
            let expected: Address = sf.scope_pda.parse().unwrap();
            let expected_value = hex32(&sf.scope_value);
            let group = self.group;
            self.admin_send(ix_create_scope(&admin_pk, &group, scope_id, one_time));
            let pda = scope_pda(&group, &scope_id);
            assert_eq!(pda, expected, "scope PDA differs from TypeScript");
            // Scope value derived on chain must equal the TypeScript derivation used for proving.
            let data = self.svm.get_account(&pda).unwrap().data;
            assert_eq!(&data[8 + 32 + 32..8 + 32 + 32 + 32], &expected_value);
            self.scopes.insert(name, pda);
        }
    }

    fn scope_verification_count(&self, scope: &Address) -> u64 {
        let data = self.svm.get_account(scope).unwrap().data;
        u64::from_le_bytes(data[8 + 96 + 1..8 + 96 + 1 + 8].try_into().unwrap())
    }

    fn verify(
        &mut self,
        p: &ProofFixture,
        message_override: Option<[u8; 32]>,
        proof_override: Option<[u8; 256]>,
    ) -> Result<TransactionMetadata, FailedTransactionMetadata> {
        let scope = self.scopes[&p.scope];
        let index = self.scope_verification_count(&scope);
        let relayer = self.relayer.insecure_clone();
        let ix = ix_verify(
            &relayer.pubkey(),
            &self.group,
            &scope,
            index,
            hex32(&p.root),
            hex32(&p.nullifier),
            message_override.unwrap_or_else(|| hex32(&p.message)),
            proof_override.unwrap_or_else(|| hex256(&p.proof)),
        );
        self.send(&[ix_compute_limit(1_400_000), ix], &[&relayer])
    }

    fn verify_ok(&mut self, p: &ProofFixture) -> TransactionMetadata {
        self.verify(p, None, None).unwrap_or_else(|e| {
            panic!("{} should verify: {:?}\n{:#?}", p.label, e.err, e.meta.logs)
        })
    }

    fn current_slot(&self) -> u64 {
        self.svm.get_sysvar::<Clock>().slot
    }
}

fn custom_code(err: &FailedTransactionMetadata) -> Option<u32> {
    let text = format!("{:?}", err.err);
    // TransactionError::InstructionError(idx, Custom(code))
    let marker = "Custom(";
    let start = text.find(marker)? + marker.len();
    let end = text[start..].find(')')? + start;
    text[start..end].parse().ok()
}

fn expect_custom(
    result: Result<TransactionMetadata, FailedTransactionMetadata>,
    code: u32,
    what: &str,
) {
    match result {
        Ok(meta) => panic!(
            "{what}: expected error {code}, but the transaction succeeded\n{:#?}",
            meta.logs
        ),
        Err(e) => {
            let got = custom_code(&e);
            assert_eq!(
                got,
                Some(code),
                "{what}: expected custom error {code}, got {:?}\n{:#?}",
                e.err,
                e.meta.logs
            );
        }
    }
}

fn receipt_fields(data: &[u8]) -> ([u8; 32], [u8; 32], [u8; 32], u64) {
    // disc(8) group(32) scope(32) index(8) root(32) nullifier(32) message(32) slot(8) ts(8) version(1) depth(1) bump(1)
    let index = u64::from_le_bytes(data[72..80].try_into().unwrap());
    let root: [u8; 32] = data[80..112].try_into().unwrap();
    let nullifier: [u8; 32] = data[112..144].try_into().unwrap();
    let message: [u8; 32] = data[144..176].try_into().unwrap();
    (root, nullifier, message, index)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn hash_vectors_match_typescript() {
    // The program's semaphore_hash is keccak256(x) >> 8. Recompute here with sha3 to
    // pin the fixture vectors (which the TypeScript side produced with noble).
    use sha3::Digest as _;
    for v in fixtures().hash_vectors {
        let input = hex32(&v.input);
        let digest = sha3::Keccak256::digest(input);
        let mut expected = [0u8; 32];
        expected[1..].copy_from_slice(&digest[..31]);
        assert_eq!(
            expected,
            hex32(&v.semaphore_hash),
            "hash vector mismatch for {}",
            v.input
        );
    }
}

#[test]
fn alice_proves_membership_and_receipt_is_public() {
    let mut h = Harness::new();
    h.setup_group(100);
    let p = h.fx.proofs["alice_scope_a"].clone();
    let meta = h.verify_ok(&p);
    println!(
        "verify_proof compute units: {}",
        meta.compute_units_consumed
    );
    assert!(meta.compute_units_consumed < 1_400_000);

    let scope = h.scopes["a"];
    let receipt = h
        .svm
        .get_account(&receipt_pda(&scope, 0))
        .expect("receipt exists");
    let (root, nullifier, message, index) = receipt_fields(&receipt.data);
    assert_eq!(root, hex32(&p.root));
    assert_eq!(nullifier, hex32(&p.nullifier));
    assert_eq!(message, hex32(&p.message));
    assert_eq!(index, 0);
    assert_eq!(h.scope_verification_count(&scope), 1);

    let record = h
        .svm
        .get_account(&nullifier_pda(&scope, &nullifier))
        .expect("nullifier record");
    let uses = u64::from_le_bytes(record.data[8 + 64..8 + 72].try_into().unwrap());
    assert_eq!(uses, 1);
}

#[test]
fn replayed_nullifier_is_rejected_in_one_time_scope() {
    let mut h = Harness::new();
    h.setup_group(100);
    let p = h.fx.proofs["alice_scope_a"].clone();
    h.verify_ok(&p);
    // Exact replay.
    expect_custom(h.verify(&p, None, None), ERR_NULLIFIER_USED, "exact replay");
    // Same identity, same scope, fresh valid proof with a different message: same nullifier.
    let p2 = h.fx.proofs["alice_scope_a_other_message"].clone();
    assert_eq!(p.nullifier, p2.nullifier);
    expect_custom(
        h.verify(&p2, None, None),
        ERR_NULLIFIER_USED,
        "second action in one-time scope",
    );
}

#[test]
fn other_member_can_still_act_in_same_scope() {
    let mut h = Harness::new();
    h.setup_group(100);
    let alice = h.fx.proofs["alice_scope_a"].clone();
    let bob = h.fx.proofs["bob_scope_a"].clone();
    h.verify_ok(&alice);
    h.verify_ok(&bob);
    assert_ne!(alice.nullifier, bob.nullifier);
    assert_eq!(h.scope_verification_count(&h.scopes["a"]), 2);
}

#[test]
fn new_scope_permits_another_action() {
    let mut h = Harness::new();
    h.setup_group(100);
    let a = h.fx.proofs["alice_scope_a"].clone();
    let b = h.fx.proofs["alice_scope_b"].clone();
    h.verify_ok(&a);
    h.verify_ok(&b);
    assert_ne!(
        a.nullifier, b.nullifier,
        "nullifiers must differ across scopes"
    );
}

#[test]
fn multi_use_scope_counts_repeat_uses() {
    let mut h = Harness::new();
    h.setup_group(100);
    let c = h.fx.proofs["alice_scope_c"].clone();
    assert!(!h.fx.scopes["c"].one_time);
    h.verify_ok(&c);
    h.verify_ok(&c);
    let scope = h.scopes["c"];
    let record = h
        .svm
        .get_account(&nullifier_pda(&scope, &hex32(&c.nullifier)))
        .unwrap();
    let uses = u64::from_le_bytes(record.data[8 + 64..8 + 72].try_into().unwrap());
    assert_eq!(uses, 2);
    assert_eq!(h.scope_verification_count(&scope), 2);
}

#[test]
fn tampered_proof_is_rejected() {
    let mut h = Harness::new();
    h.setup_group(100);
    let p = h.fx.proofs["alice_scope_a"].clone();
    let mut proof = hex256(&p.proof);
    proof[200] ^= 0x01; // one bit of C.x
    expect_custom(
        h.verify(&p, None, Some(proof)),
        ERR_INVALID_PROOF,
        "tampered proof",
    );
    assert_eq!(h.scope_verification_count(&h.scopes["a"]), 0);
}

#[test]
fn zero_proof_is_rejected() {
    let mut h = Harness::new();
    h.setup_group(100);
    let p = h.fx.proofs["alice_scope_a"].clone();
    let result = h.verify(&p, None, Some([0u8; 256]));
    let err = result.expect_err("all-zero proof must fail");
    let code = custom_code(&err);
    assert!(
        code == Some(ERR_INVALID_PROOF) || code == Some(ERR_MALFORMED_PROOF),
        "unexpected error {:?}\n{:#?}",
        err.err,
        err.meta.logs
    );
}

#[test]
fn wrong_message_binding_is_rejected() {
    let mut h = Harness::new();
    h.setup_group(100);
    let p = h.fx.proofs["alice_scope_a"].clone();
    let other = h.fx.proofs["alice_scope_a_other_message"].clone();
    assert_ne!(p.message, other.message);
    // Valid proof for "vote:yes" submitted with the message "vote:no".
    expect_custom(
        h.verify(&p, Some(hex32(&other.message)), None),
        ERR_INVALID_PROOF,
        "message swap",
    );
}

#[test]
fn proof_for_wrong_scope_is_rejected() {
    let mut h = Harness::new();
    h.setup_group(100);
    // alice_scope_b proof submitted against scope a (same root, same prover, wrong scope hash).
    let mut p = h.fx.proofs["alice_scope_b"].clone();
    p.scope = "a".to_string();
    expect_custom(h.verify(&p, None, None), ERR_INVALID_PROOF, "scope swap");
}

#[test]
fn forged_root_is_rejected() {
    let mut h = Harness::new();
    h.setup_group(100);
    let forged = h.fx.forged.clone();
    assert_ne!(forged.root, h.fx.root);
    expect_custom(
        h.verify(&forged, None, None),
        ERR_UNKNOWN_ROOT,
        "unpublished root",
    );
}

#[test]
fn unauthorized_admin_cannot_change_root_or_scopes() {
    let mut h = Harness::new();
    h.setup_group(100);
    let mallory = Keypair::new();
    h.svm.airdrop(&mallory.pubkey(), 1_000_000_000).unwrap();
    let group = h.group;
    let forged_root = hex32(&h.fx.forged_root);
    let res = h.send(
        &[ix_update_root(&mallory.pubkey(), &group, forged_root, 3)],
        &[&mallory],
    );
    expect_custom(res, ERR_UNAUTHORIZED, "mallory update_group_root");
    let res = h.send(
        &[ix_create_scope(&mallory.pubkey(), &group, [7u8; 32], true)],
        &[&mallory],
    );
    expect_custom(res, ERR_UNAUTHORIZED, "mallory create_scope");
    let res = h.send(
        &[ix_transfer_admin(
            &mallory.pubkey(),
            &group,
            &mallory.pubkey(),
        )],
        &[&mallory],
    );
    expect_custom(res, ERR_UNAUTHORIZED, "mallory transfer_group_admin");
    let res = h.send(
        &[ix_set_root_validity(&mallory.pubkey(), &group, 0)],
        &[&mallory],
    );
    expect_custom(res, ERR_UNAUTHORIZED, "mallory set_root_validity");
}

#[test]
fn superseded_root_expires_after_validity_window() {
    let mut h = Harness::new();
    h.setup_group(10);
    let admin = h.admin.pubkey();
    let group = h.group;
    // Membership changes: a new root replaces the fixture root.
    let new_root = hex32(&h.fx.forged_root);
    h.admin_send(ix_update_root(&admin, &group, new_root, 3));

    // Within the window the old root still verifies (bob's proof was built against it).
    let bob = h.fx.proofs["bob_scope_a"].clone();
    h.verify_ok(&bob);

    // Past the window it is stale.
    let slot = h.current_slot();
    h.svm.warp_to_slot(slot + 50);
    let alice = h.fx.proofs["alice_scope_a"].clone();
    expect_custom(h.verify(&alice, None, None), ERR_STALE_ROOT, "stale root");
}

#[test]
fn zero_validity_makes_old_roots_stale_immediately() {
    let mut h = Harness::new();
    h.setup_group(0);
    let admin = h.admin.pubkey();
    let group = h.group;
    let forged_root = hex32(&h.fx.forged_root);
    h.admin_send(ix_update_root(&admin, &group, forged_root, 3));
    let slot = h.current_slot();
    h.svm.warp_to_slot(slot + 1);
    let alice = h.fx.proofs["alice_scope_a"].clone();
    expect_custom(
        h.verify(&alice, None, None),
        ERR_STALE_ROOT,
        "zero validity",
    );
}

#[test]
fn scope_of_another_group_is_rejected() {
    let mut h = Harness::new();
    h.setup_group(100);
    let admin = h.admin.pubkey();
    // Second group with the same root published.
    let other_group_id = [9u8; 32];
    let root = hex32(&h.fx.root);
    h.admin_send(ix_initialize_group(&admin, other_group_id, root, 100));
    let other_group = group_pda(&other_group_id);
    let p = h.fx.proofs["alice_scope_a"].clone();
    let scope = h.scopes["a"];
    let relayer = h.relayer.insecure_clone();
    let ix = ix_verify(
        &relayer.pubkey(),
        &other_group,
        &scope,
        0,
        hex32(&p.root),
        hex32(&p.nullifier),
        hex32(&p.message),
        hex256(&p.proof),
    );
    let res = h.send(&[ix_compute_limit(1_400_000), ix], &[&relayer]);
    expect_custom(res, ERR_SCOPE_GROUP_MISMATCH, "scope/group mismatch");
}

#[test]
fn non_field_public_inputs_are_rejected() {
    let mut h = Harness::new();
    h.setup_group(100);
    let admin = h.admin.pubkey();
    let group = h.group;
    // A root >= r is not a valid field element and must be refused at publication.
    let admin_kp = h.admin.insecure_clone();
    let res = h.send(
        &[ix_update_root(&admin, &group, [0xffu8; 32], 2)],
        &[&admin_kp],
    );
    expect_custom(res, ERR_INVALID_PUBLIC_INPUT, "non-field root");
    // A nullifier >= r is refused before any pairing work.
    let p = h.fx.proofs["alice_scope_a"].clone();
    let scope = h.scopes["a"];
    let relayer = h.relayer.insecure_clone();
    let ix = ix_verify(
        &relayer.pubkey(),
        &group,
        &scope,
        0,
        hex32(&p.root),
        [0xffu8; 32],
        hex32(&p.message),
        hex256(&p.proof),
    );
    let res = h.send(&[ix_compute_limit(1_400_000), ix], &[&relayer]);
    expect_custom(res, ERR_INVALID_PUBLIC_INPUT, "non-field nullifier");
}

#[test]
fn admin_transfer_hands_over_control() {
    let mut h = Harness::new();
    h.setup_group(100);
    let admin = h.admin.pubkey();
    let group = h.group;
    let new_admin = Keypair::new();
    h.svm.airdrop(&new_admin.pubkey(), 1_000_000_000).unwrap();
    h.admin_send(ix_transfer_admin(&admin, &group, &new_admin.pubkey()));
    // Old admin locked out, new admin works.
    let forged_root = hex32(&h.fx.forged_root);
    let admin_kp = h.admin.insecure_clone();
    let res = h.send(
        &[ix_update_root(&admin, &group, forged_root, 3)],
        &[&admin_kp],
    );
    expect_custom(res, ERR_UNAUTHORIZED, "old admin after transfer");
    h.send(
        &[ix_update_root(&new_admin.pubkey(), &group, forged_root, 3)],
        &[&new_admin],
    )
    .expect("new admin updates root");
}
